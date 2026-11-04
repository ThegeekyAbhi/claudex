import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { makeDiff, patchFromHunks } from '../diff';
import {
  type Delegate,
  type DelegateRequest,
  type EventSink,
  type ImageInput,
  parseRunAgent,
  RUN_AGENT_DESCRIPTION,
  RUN_AGENT_TOOL,
  runAgentApprovalTitle,
  runAgentInput,
  runAgentResultText,
  type Session,
  type Status,
  type ToolInfo,
  type TranscriptEvent,
} from '../model';
import { readClaudeTitle } from './claude-title';
import { claudeToolDiffs, describeClaudeTool, resultText } from './tool-format';
import { claudeContextTokens, claudeLimits } from './usage';

/** The Messages API's limit for one image. */
const MAX_CLAUDE_IMAGE = 5 * 1024 * 1024;

type QueryFunction = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
export interface ClaudeOptions {
  env?: Record<string, string>;
  delegate?: Delegate;
  /** Test seam; the installed SDK is used when omitted. */
  query?: QueryFunction;
  titleRetryMs?: number;
}
const RUN_AGENT_FULL_NAME = `mcp__agent-workspace__${RUN_AGENT_TOOL}`;
const DELEGATE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const USAGE_TIMEOUT_MS = 1500;

interface WorkerState {
  id: string;
  background: boolean;
  finished: boolean;
}
export class ClaudeAgent {
  private query?: Query;
  private lastContextTokens?: number;
  private stopped = false;
  private disposed = false;
  /** Streamed blocks per message, matched to the final frames that repeat them. */
  private blocks = new Map<string, { type: string; id: string; used: boolean }[]>();
  private activeMessage = new Map<string, string>();
  private workers = new Map<string, WorkerState>();
  private toolKinds = new Map<string, ToolInfo['kind']>();
  private declined = new Set<string>();
  private pendingRunAgent: string[] = [];
  constructor(
    private session: Session,
    private executable: string,
    private emit: EventSink,
    private options: ClaudeOptions = {},
  ) {}
  private async delegateServer(): Promise<Options['mcpServers']> {
    const delegate = this.options.delegate;
    if (!delegate) return undefined;
    const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
    const server = createSdkMcpServer({
      name: 'agent-workspace',
      version: '0.5.0',
      tools: [
        tool(
          RUN_AGENT_TOOL,
          RUN_AGENT_DESCRIPTION,
          {
            agent: z.enum(['codex', 'claude', 'claude2']),
            prompt: runAgentInput.shape.prompt,
            model: runAgentInput.shape.model,
            effort: runAgentInput.shape.effort,
          },
          async (args) => {
            const request = parseRunAgent(args);
            const toolId = this.pendingRunAgent.shift();
            const result = await delegate(request, (sessionId) => {
              if (toolId) this.emit({ type: 'patch', id: toolId, tool: { workerId: sessionId } });
            });
            return {
              content: [{ type: 'text', text: runAgentResultText(request, result) }],
              isError: result.status !== 'completed',
            };
          },
          { alwaysLoad: true },
        ),
      ],
    });
    // Each delegation stays user-approved even where settings allow every MCP tool.
    return {
      'agent-workspace': {
        ...server,
        // The call lasts as long as the other agent's turn, so it gets a generous limit.
        timeout: DELEGATE_TIMEOUT_MS,
        tools: [{ name: RUN_AGENT_TOOL, permission_policy: 'always_ask' as const }],
      },
    };
  }
  private async content(text: string, images?: ImageInput[]) {
    if (!images?.length) return text;
    const blocks = await Promise.all(
      images.map(async (image) => {
        const bytes = await readFile(image.path);
        if (bytes.length > MAX_CLAUDE_IMAGE)
          throw new Error('Claude can read images of up to 5 MB. Attach a smaller one.');
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mediaType,
            data: bytes.toString('base64'),
          },
        };
      }),
    );
    return [{ type: 'text', text }, ...blocks];
  }
  async send(text: string, images?: ImageInput[]): Promise<void> {
    this.stopped = false;
    const content = await this.content(text, images);
    const queryFunction =
      this.options.query ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
    const mcpServers = await this.delegateServer();
    let sawResult = false;
    let finishPrompt = () => {};
    const promptDone = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });
    // The stream stays open for the whole turn because in-process tools answer over it.
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      } as SDKUserMessage;
      await promptDone;
    }
    const { env } = this.options;
    this.query = queryFunction({
      prompt: prompt(),
      options: {
        cwd: this.session.cwd,
        pathToClaudeCodeExecutable: this.executable,
        resume: this.session.nativeId,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true,
        forwardSubagentText: true,
        abortController: new AbortController(),
        ...(env ? { env: { ...process.env, ...env } } : {}),
        ...(this.session.model ? { model: this.session.model } : {}),
        ...(this.session.effort ? { effort: this.session.effort as Options['effort'] } : {}),
        ...(this.session.adaptiveThinking === false
          ? {}
          : { thinking: { type: 'adaptive' as const, display: 'summarized' as const } }),
        ...(mcpServers ? { mcpServers } : {}),
        ...(this.session.mode === 'plan' ? { permissionMode: 'plan' as const } : {}),
        canUseTool: (name, input, options) => this.permission(name, input, options),
      },
    });
    const currentQuery = this.query;
    try {
      for await (const message of currentQuery) {
        if ('session_id' in message && message.session_id)
          this.emit({ type: 'nativeId', id: message.session_id });
        this.receive(message);
        if (message.type === 'result') {
          sawResult = true;
          // These need the CLI still running, which ending the prompt stops.
          if (!this.stopped) await this.reportUsage(currentQuery, message);
          finishPrompt();
          this.result(message);
        }
      }
      if (!sawResult)
        this.emit({ type: 'status', status: this.stopped ? 'interrupted' : 'failed' });
    } catch (error) {
      if (!this.stopped) throw error;
      this.emit({ type: 'status', status: 'interrupted' });
    } finally {
      finishPrompt();
      currentQuery.close();
      if (this.query === currentQuery) this.query = undefined;
      this.closeOpenWorkers();
      this.blocks.clear();
      this.activeMessage.clear();
      void this.reportTitle();
    }
  }
  /** Neither call runs a model turn. Usage is optional, so a failure here never fails the turn. */
  private async reportUsage(
    query: Query,
    message: Extract<SDKMessage, { type: 'result' }>,
  ): Promise<void> {
    const bounded = <T>(read: () => Promise<T>) =>
      Promise.race([
        Promise.resolve().then(read),
        new Promise<undefined>((resolve) => setTimeout(resolve, USAGE_TIMEOUT_MS)),
      ]).catch(() => undefined);
    const [window, plan] = await Promise.all([
      bounded(() => query.getContextUsage({ detail: 'summary' })),
      bounded(() =>
        query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      ),
    ]);
    const reportedMax = Object.values(message.modelUsage ?? {})[0]?.contextWindow;
    const context =
      window && window.maxTokens > 0
        ? { used: window.totalTokens, max: window.maxTokens }
        : this.lastContextTokens !== undefined && reportedMax > 0
          ? { used: this.lastContextTokens, max: reportedMax }
          : undefined;
    const limits = claudeLimits(plan?.rate_limits);
    if (context || limits.length)
      this.emit({
        type: 'usage',
        ...(context ? { context } : {}),
        ...(limits.length ? { limits } : {}),
      });
  }
  private result(message: Extract<SDKMessage, { type: 'result' }>): void {
    if (message.is_error)
      this.emit({
        type: 'message',
        message: {
          id: message.uuid,
          role: 'notice',
          text: 'errors' in message ? message.errors.join('\n') : message.result,
        },
      });
    const status: Status = this.stopped ? 'interrupted' : message.is_error ? 'failed' : 'completed';
    this.emit({ type: 'status', status });
  }
  private permission(
    name: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID?: string },
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const questions =
        name === 'AskUserQuestion' && Array.isArray(input.questions)
          ? input.questions.map((q: any) => ({
              id: q.question,
              prompt: q.question,
              options: (q.options ?? []).map((o: any) => o.label),
              details: Object.fromEntries(
                (q.options ?? [])
                  .filter((o: any) => o.description)
                  .map((o: any) => [o.label, String(o.description)]),
              ),
              ...(q.multiSelect ? { multiple: true } : {}),
            }))
          : undefined;
      let settled = false;
      const finish = (result: PermissionResult) => {
        if (!settled) {
          settled = true;
          options.signal.removeEventListener('abort', cancel);
          resolve(result);
        }
      };
      const cancel = () => {
        finish({ behavior: 'deny', message: 'Request was interrupted.' });
      };
      options.signal.addEventListener('abort', cancel, { once: true });
      if (options.signal.aborted) {
        cancel();
        return;
      }
      if (name === 'ExitPlanMode') {
        void this.requestPlanApproval(input, options.toolUseID, finish);
        return;
      }
      const runAgent = name === RUN_AGENT_FULL_NAME ? this.parseRunAgent(input) : undefined;
      const diffs = claudeToolDiffs(name, input, this.session.cwd);
      this.emit({
        type: 'approval',
        approval: {
          id: randomUUID(),
          title: questions
            ? 'Your input is needed'
            : runAgent
              ? runAgentApprovalTitle(runAgent)
              : `Allow ${name}?`,
          detail: runAgent ? runAgent.prompt : JSON.stringify(input, null, 2),
          questions,
          ...(diffs ? { diffs } : {}),
        },
        respond: (allowed, answers) => {
          if (!allowed && options.toolUseID) this.declined.add(options.toolUseID);
          finish(
            allowed
              ? { behavior: 'allow', updatedInput: questions ? { ...input, answers } : input }
              : { behavior: 'deny', message: 'Declined by the user.' },
          );
        },
      });
    });
  }
  /** The SDK does not type this input, so the plan's text may be inline or in the CLI's file. */
  private async planText(input: Record<string, unknown>): Promise<string> {
    if (typeof input.plan === 'string' && input.plan.trim()) return input.plan;
    const file = input.planFilePath;
    if (
      typeof file === 'string' &&
      file.endsWith('.md') &&
      file.includes(`${path.sep}plans${path.sep}`)
    )
      return readFile(file, 'utf8').catch(() => '');
    return '';
  }
  private async requestPlanApproval(
    input: Record<string, unknown>,
    toolUseId: string | undefined,
    finish: (result: PermissionResult) => void,
  ): Promise<void> {
    const text = await this.planText(input);
    this.emit({
      type: 'plan',
      final: true,
      text: text || 'Claude asked to leave plan mode but did not share the plan’s text.',
    });
    this.emit({
      type: 'approval',
      approval: { id: randomUUID(), title: 'Build this plan?', detail: '', kind: 'plan' },
      respond: (allowed) => {
        if (!allowed) {
          if (toolUseId) this.declined.add(toolUseId);
          finish({
            behavior: 'deny',
            message:
              'The user wants to keep planning. Stay in plan mode and wait for their feedback.',
          });
          return;
        }
        void this.query?.setPermissionMode?.('default').catch(() => {});
        finish({ behavior: 'allow', updatedInput: input });
      },
    });
  }
  private parseRunAgent(input: unknown): DelegateRequest | undefined {
    try {
      return parseRunAgent(input);
    } catch {
      return undefined;
    }
  }
  /** Routes transcript events to the lead, or to the subagent whose tool call produced them. */
  private out(parent: string | null | undefined, event: TranscriptEvent): void {
    if (parent) this.emit({ type: 'worker', id: this.workerFor(parent).id, inner: event });
    else this.emit(event);
  }
  private workerFor(toolUseId: string, background = false): WorkerState {
    let worker = this.workers.get(toolUseId);
    if (!worker) {
      worker = { id: toolUseId, background, finished: false };
      this.workers.set(toolUseId, worker);
    }
    return worker;
  }
  private receive(message: SDKMessage): void {
    if (message.type === 'stream_event') this.stream(message);
    else if (message.type === 'assistant') this.assistant(message);
    else if (message.type === 'user') this.user(message);
    else if (message.type === 'system') this.system(message);
  }
  private stream(message: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const event = message.event;
    const parent = message.parent_tool_use_id;
    const key = parent ?? '';
    if (event.type === 'message_start') this.activeMessage.set(key, event.message.id);
    const messageId = this.activeMessage.get(key) ?? message.uuid;
    if (event.type === 'content_block_start') {
      const list = this.blocks.get(messageId) ?? [];
      list.push({
        type: event.content_block.type,
        id: `${messageId}-${event.index}`,
        used: false,
      });
      this.blocks.set(messageId, list);
    }
    if (event.type === 'content_block_delta') {
      const id = `${messageId}-${event.index}`;
      if (event.delta.type === 'text_delta')
        this.out(parent, { type: 'delta', id, text: event.delta.text });
      if (event.delta.type === 'thinking_delta')
        this.out(parent, { type: 'delta', id, role: 'thinking', text: event.delta.thinking });
    }
  }
  private claimBlock(messageId: string, type: string): string {
    const match = this.blocks.get(messageId)?.find((block) => block.type === type && !block.used);
    if (!match) return `${messageId}-${randomUUID()}`;
    match.used = true;
    return match.id;
  }
  private assistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
    const parent = message.parent_tool_use_id;
    if (message.message.model && !parent && message.message.model !== '<synthetic>')
      this.emit({ type: 'activeModel', model: message.message.model });
    if (!parent) this.lastContextTokens = claudeContextTokens(message.message.usage);
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text) {
        const id = this.claimBlock(message.message.id, 'text');
        this.out(parent, { type: 'message', message: { id, role: 'assistant', text: block.text } });
      } else if (block.type === 'thinking') {
        const id = this.claimBlock(message.message.id, 'thinking');
        if (block.thinking)
          this.out(parent, {
            type: 'message',
            message: { id, role: 'thinking', text: block.thinking },
          });
      } else if (block.type === 'tool_use') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const description =
          block.name === RUN_AGENT_FULL_NAME
            ? this.describeRunAgent(input)
            : describeClaudeTool(block.name, input, this.session.cwd);
        this.toolKinds.set(block.id, description.kind);
        if (block.name === RUN_AGENT_FULL_NAME) this.pendingRunAgent.push(block.id);
        this.out(parent, {
          type: 'message',
          message: {
            id: block.id,
            role: 'tool',
            text: '',
            tool: { ...description, status: 'running' },
          },
        });
      }
    }
  }
  private describeRunAgent(input: Record<string, unknown>) {
    const request = this.parseRunAgent(input);
    return {
      kind: 'agent' as const,
      name: RUN_AGENT_TOOL,
      title: request?.prompt.split('\n')[0] ?? 'Run another agent',
      input: request?.prompt,
    };
  }
  private user(message: Extract<SDKMessage, { type: 'user' }>): void {
    const parent = message.parent_tool_use_id;
    const content = message.message.content;
    if (parent && typeof content === 'string') {
      this.out(parent, {
        type: 'message',
        message: { id: message.uuid ?? randomUUID(), role: 'user', text: content },
      });
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block.type === 'text' && parent)
        this.out(parent, {
          type: 'message',
          message: { id: message.uuid ?? randomUUID(), role: 'user', text: block.text },
        });
      if (block.type !== 'tool_result') continue;
      const failed = Boolean(block.is_error);
      const status: ToolInfo['status'] = this.declined.delete(block.tool_use_id)
        ? 'declined'
        : failed
          ? 'failed'
          : 'completed';
      const diffs = failed ? undefined : this.reportedDiffs(message);
      this.out(parent, {
        type: 'patch',
        id: block.tool_use_id,
        text: resultText(block.content),
        tool: { status, ...(diffs ? { diffs } : {}) },
      });
      this.finishForegroundWorker(block.tool_use_id, failed);
    }
  }
  /** Claude Code reports the real hunks for an applied edit; they carry true line numbers. */
  private reportedDiffs(message: Extract<SDKMessage, { type: 'user' }>) {
    const result = (message as { tool_use_result?: any }).tool_use_result;
    if (!result || !Array.isArray(result.structuredPatch) || !result.structuredPatch.length)
      return undefined;
    const file = String(result.filePath ?? '');
    const cwd = `${this.session.cwd}/`;
    return [
      makeDiff(
        file.startsWith(cwd) ? file.slice(cwd.length) : file,
        result.type === 'create' ? 'add' : 'update',
        patchFromHunks(result.structuredPatch),
      ),
    ];
  }
  private finishForegroundWorker(toolUseId: string, failed: boolean): void {
    const worker = this.workers.get(toolUseId);
    if (!worker || worker.finished || worker.background) return;
    if (this.toolKinds.get(toolUseId) !== 'agent') return;
    worker.finished = true;
    this.emit({ type: 'worker', id: worker.id, status: failed ? 'failed' : 'completed' });
  }
  private system(message: Extract<SDKMessage, { type: 'system' }>): void {
    if (message.subtype === 'init' && message.model)
      this.emit({ type: 'activeModel', model: message.model });
    if (message.subtype === 'task_started' && !message.ambient) {
      const worker = this.workerFor(
        message.tool_use_id ?? message.task_id,
        Boolean(message.is_backgrounded),
      );
      worker.background = Boolean(message.is_backgrounded);
      this.emit({
        type: 'worker',
        id: worker.id,
        title: message.description,
        status: 'running',
      });
    }
    if (message.subtype === 'task_notification' && !message.ambient) {
      const worker = this.workerFor(message.tool_use_id ?? message.task_id);
      worker.finished = true;
      this.emit({
        type: 'worker',
        id: worker.id,
        status: message.status === 'stopped' ? 'interrupted' : message.status,
        inner: {
          type: 'message',
          message: { id: message.uuid, role: 'notice', text: message.summary },
        },
      });
    }
  }
  /** The query ends with the turn, so a worker with no reported outcome did not finish here. */
  private closeOpenWorkers(): void {
    for (const worker of this.workers.values())
      if (!worker.finished) {
        worker.finished = true;
        this.emit({ type: 'worker', id: worker.id, status: 'interrupted' });
      }
    this.workers.clear();
    this.pendingRunAgent = [];
  }
  private async reportTitle(): Promise<void> {
    const delays = [0, this.options.titleRetryMs ?? 4000];
    let last: string | undefined;
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay).unref?.());
      const id = this.session.nativeId;
      if (this.disposed || !id) return;
      const title = await readClaudeTitle(id, this.session.cwd, this.options.env).catch(
        () => undefined,
      );
      if (title && title !== last) {
        last = title;
        this.emit({ type: 'title', title });
      }
    }
  }
  async interrupt(): Promise<void> {
    this.stopped = true;
    if (this.query) {
      await this.query.interrupt();
      this.query.close();
    }
  }
  dispose(): void {
    this.stopped = true;
    this.disposed = true;
    this.query?.close();
  }
}
