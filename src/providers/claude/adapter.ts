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
import { makeDiff, patchFromHunks } from '../../shared/domain/diff';
import {
  type AgentMode,
  type Delegate,
  type DelegateRequest,
  type EventSink,
  type ImageInput,
  MODE_LABELS,
  modeView,
  parseRunAgent,
  RUN_AGENT_TOOL,
  runAgentApprovalTitle,
  runAgentDescription,
  runAgentInput,
  runAgentNames,
  runAgentResultText,
  type Session,
  type SkillRequest,
  type Status,
  type ToolInfo,
  type TranscriptEvent,
} from '../../shared/model';
import { claudeToolDiffs, describeClaudeTool, resultText } from '../tool-format';
import { claudeContextTokens, claudeLimits } from '../usage';
import { readClaudeTitle } from './title';

/** The Messages API's limit for one image. */
function thinkingOptions(session: Session): Pick<Options, 'thinking'> {
  if (session.thinking === 'off') return { thinking: { type: 'disabled' } };
  if (session.thinking === 'on' && session.adaptiveThinking !== false)
    return { thinking: { type: 'adaptive', display: 'summarized' } };
  return {};
}

const MAX_CLAUDE_IMAGE = 5 * 1024 * 1024;

type QueryFunction = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
export interface ClaudeOptions {
  env?: Record<string, string>;
  delegate?: Delegate;
  skills?: () => SkillRequest[];
  /** Test seam; the installed SDK is used when omitted. */
  query?: QueryFunction;
  titleRetryMs?: number;
}
const RUN_AGENT_FULL_NAME = `mcp__agent-workspace__${RUN_AGENT_TOOL}`;
const DELEGATE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

interface WorkerState {
  id: string;
  background: boolean;
  finished: boolean;
}
/** Ask has no CLI mode of its own: dontAsk denies what isn't pre-approved, and edit tools go. */
const ASK_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
export function claudeModeOptions(mode: AgentMode | undefined): {
  permissionMode?: NonNullable<Options['permissionMode']>;
  disallowedTools?: string[];
} {
  if (mode === 'ask') return { permissionMode: 'dontAsk', disallowedTools: ASK_DISALLOWED_TOOLS };
  if (mode === 'plan') return { permissionMode: 'plan' };
  if (mode === 'auto') return { permissionMode: 'auto' };
  return {};
}
/** A slash command must lead the prompt, so one skill leads and any others are named after it. */
export function claudeSkillText(text: string, skills: SkillRequest[] = []): string {
  const [first, ...rest] = skills;
  if (!first) return text;
  const others = rest.length
    ? `\n\nAlso use these skills: ${rest.map((skill) => skill.name).join(', ')}.`
    : '';
  return `/${first.name} ${text}${others}`;
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
  private requestedSkills: SkillRequest[] = [];
  private turnFinished?: Promise<void>;
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
      version: '0.6.0',
      tools: [
        tool(
          RUN_AGENT_TOOL,
          runAgentDescription(),
          {
            agent: z.enum(runAgentNames()),
            prompt: runAgentInput.shape.prompt,
            model: runAgentInput.shape.model,
            effort: runAgentInput.shape.effort,
          },
          async (args, extra) => {
            const request = parseRunAgent(args);
            const toolId = this.takeRunAgentId(extra);
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
  /**
   * Which `run_agent` row this call belongs to. The call's own id wins when the CLI passes it;
   * otherwise the oldest call still waiting, skipping any that were declined or cancelled, since
   * those never reach the handler and would shift every later pairing.
   */
  private takeRunAgentId(extra: unknown): string | undefined {
    const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
    const own = meta?.['claudecode/toolUseId'];
    const pending = this.pendingRunAgent.filter((id) => !this.declined.has(id));
    // The CLI's own id is the only sure match. It isn't documented, so without one the oldest
    // waiting call is the best match; with one that isn't waiting, no row is claimed at all.
    const id = typeof own === 'string' ? (pending.includes(own) ? own : undefined) : pending[0];
    if (!id) return undefined;
    this.pendingRunAgent = this.pendingRunAgent.filter(
      (item) => item !== id && pending.includes(item),
    );
    return id;
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
  async send(text: string, images?: ImageInput[], skills?: SkillRequest[]): Promise<void> {
    this.requestedSkills = skills ?? [];
    this.stopped = false;
    const content = await this.content(claudeSkillText(text, skills), images);
    const queryFunction =
      this.options.query ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
    // Ask is read-only, and another agent started from here wouldn't be.
    const mcpServers = this.session.mode === 'ask' ? undefined : await this.delegateServer();
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
        ...thinkingOptions(this.session),
        ...(mcpServers ? { mcpServers } : {}),
        ...claudeModeOptions(this.session.mode),
        canUseTool: (name, input, options) => this.permission(name, input, options),
      },
    });
    const currentQuery = this.query;
    let finishTurn = () => {};
    this.turnFinished = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });
    try {
      for await (const message of currentQuery) {
        if ('session_id' in message && message.session_id)
          this.emit({ type: 'nativeId', id: message.session_id });
        this.receive(message);
        if (message.type === 'result') {
          sawResult = true;
          finishPrompt();
          this.reportContext(message);
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
      finishTurn();
      void this.reportTitle();
    }
  }
  /** From what the turn already reported, so measuring it costs the turn nothing. */
  private reportContext(message: Extract<SDKMessage, { type: 'result' }>): void {
    const max = Object.values(message.modelUsage ?? {})[0]?.contextWindow;
    if (this.lastContextTokens !== undefined && max > 0)
      this.emit({ type: 'usage', context: { used: this.lastContextTokens, max } });
  }
  /** Runs in the background while the CLI is up; it is no model turn, and may simply fail. */
  private readPlanLimits(query: Query): void {
    void Promise.resolve()
      .then(() =>
        query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      )
      .then((plan) => {
        const limits = claudeLimits(plan?.rate_limits);
        if (limits.length) this.emit({ type: 'usage', limits });
      })
      .catch(() => {});
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
        void this.requestPlanApproval(input, options.toolUseID, finish, options.signal);
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
          origin: runAgent ? 'delegation' : 'provider',
          ...(diffs ? { diffs } : {}),
        },
        respond: (allowed, answers) => {
          if (!allowed && options.toolUseID) {
            this.declined.add(options.toolUseID);
            this.pendingRunAgent = this.pendingRunAgent.filter((id) => id !== options.toolUseID);
          }
          // Allow in Auto changes the mode for what follows, without waiting for the next turn.
          if (allowed && this.session.mode === 'auto') this.applyMode();
          finish(
            allowed
              ? { behavior: 'allow', updatedInput: questions ? { ...input, answers } : input }
              : { behavior: 'deny', message: 'Declined by the user.' },
          );
        },
      });
    });
  }
  /** A failure is reported: the thread must not claim a mode the CLI didn't take. */
  private applyMode(): void {
    const next = claudeModeOptions(this.session.mode).permissionMode ?? 'default';
    void this.query?.setPermissionMode?.(next).catch((error: unknown) => {
      this.emit({
        type: 'message',
        message: {
          id: randomUUID(),
          role: 'notice',
          text: `Could not switch Claude Code to ${next} mode: ${error instanceof Error ? error.message : String(error)}`,
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
    signal: AbortSignal,
  ): Promise<void> {
    const text = await this.planText(input);
    if (signal.aborted) return;
    if (!text.trim()) {
      this.emit({
        type: 'message',
        message: {
          id: randomUUID(),
          role: 'notice',
          text: 'Claude did not share its plan. Ask it to present the plan before implementing.',
        },
      });
      finish({
        behavior: 'deny',
        message: 'Share the finished plan text before asking to leave plan mode.',
      });
      return;
    }
    this.emit({
      type: 'plan',
      final: true,
      text,
    });
    this.emit({
      type: 'approval',
      approval: { id: randomUUID(), title: 'Build this plan?', detail: '', kind: 'plan' },
      respond: (allowed, answers) => {
        if (!allowed) {
          if (toolUseId) this.declined.add(toolUseId);
          finish({
            behavior: 'deny',
            message: answers.feedback
              ? `The user wants to keep planning. Stay in plan mode and revise the plan. Their feedback:\n\n${answers.feedback}`
              : 'The user wants to keep planning. Stay in plan mode and wait for their feedback.',
          });
          return;
        }
        this.applyMode();
        // Answers carry your edited plan when you changed the file.
        finish({
          behavior: 'allow',
          updatedInput: answers.plan ? { ...input, plan: answers.plan } : input,
        });
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
  /**
   * Rebuilds rows from one record of the CLI's saved transcript, through the same mapping a live
   * turn uses. Only for an instance made to read history: it never starts the CLI.
   */
  replayRecord(record: unknown): void {
    const message = record as SDKMessage;
    if (message.type === 'assistant') this.assistant(message);
    else if (message.type === 'user') this.user(message);
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
            : describeClaudeTool(block.name, input, this.session.cwd, [
                ...(this.options.skills?.() ?? []),
                ...this.requestedSkills,
              ]);
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
      // A finished call no longer waits for its handler, whether it ran, was declined or cancelled.
      this.pendingRunAgent = this.pendingRunAgent.filter((id) => id !== block.tool_use_id);
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
  /** The chip shows this mode, and a request the CLI didn't honor gets a line of its own. */
  private reportMode(reported: string | undefined): void {
    if (!reported) return;
    this.emit({ type: 'reportedMode', mode: reported });
    const { mode } = this.session;
    if (!mode || claudeModeOptions(mode).permissionMode === reported) return;
    const actual = modeView(undefined, reported).label;
    this.emit({
      type: 'message',
      message: {
        id: randomUUID(),
        role: 'notice',
        text: `${MODE_LABELS[mode]} isn’t available here, so Claude is running in ${actual}.`,
      },
    });
  }
  private system(message: Extract<SDKMessage, { type: 'system' }>): void {
    if (message.subtype === 'status' && message.permissionMode)
      this.emit({ type: 'reportedMode', mode: message.permissionMode });
    if (message.subtype === 'init') {
      if (message.model) this.emit({ type: 'activeModel', model: message.model });
      this.reportMode(message.permissionMode);
      // Our own delegation server isn't one of yours.
      this.emit({
        type: 'runtime',
        runtime: {
          mcpServers: (message.mcp_servers ?? [])
            .filter((server) => server.name !== 'agent-workspace')
            .map((server) => ({ name: server.name, status: server.status })),
        },
      });
      if (this.query) this.readPlanLimits(this.query);
    }
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
      await this.turnFinished;
    }
  }
  dispose(): void {
    this.stopped = true;
    this.disposed = true;
    this.query?.close();
  }
}
