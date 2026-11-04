import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ImageStore } from '../attachments';
import { makeDiff, patchFromContent, stripPatchHeader } from '../diff';
import { resolveInside } from '../documents';
import {
  type Agent,
  type Delegate,
  type DelegateRequest,
  deriveTitle,
  type EventSink,
  type FileDiff,
  type ImageInput,
  type MessageImage,
  parseRunAgent,
  type Question,
  RUN_AGENT_DESCRIPTION,
  RUN_AGENT_JSON_SCHEMA,
  RUN_AGENT_TOOL,
  runAgentApprovalTitle,
  runAgentResultText,
  type Session,
  type Status,
  type ToolInfo,
  type TranscriptEvent,
} from '../model';
import { JsonRpc, type RpcMessage } from './process';
import { displayCommand } from './tool-format';
import { codexLimits } from './usage';

function fileDiffs(changes: any[] | undefined): FileDiff[] {
  return (changes ?? []).map((change) => {
    const kind =
      change.kind?.type === 'add' ? 'add' : change.kind?.type === 'delete' ? 'delete' : 'update';
    const raw = String(change.diff ?? '');
    // Added and deleted files can arrive as plain content rather than as hunks.
    const patch =
      kind !== 'update' && raw && !raw.includes('@@')
        ? patchFromContent(raw, kind === 'add' ? '+' : '-')
        : stripPatchHeader(raw);
    return makeDiff(String(change.path), kind, patch);
  });
}
function toolStatus(status: string | undefined, completed: boolean, failed = false) {
  if (status === 'declined') return 'declined' as const;
  if (status === 'failed' || failed) return 'failed' as const;
  return completed ? ('completed' as const) : ('running' as const);
}
const WORKER_TOOL_TITLES: Record<string, string> = {
  spawnAgent: 'Started a worker',
  sendInput: 'Messaged a worker',
  resumeAgent: 'Resumed a worker',
  wait: 'Waited for a worker',
  closeAgent: 'Closed a worker',
};
export interface CodexOptions {
  delegate?: Delegate;
  images?: ImageStore;
}
function optionDetails(options: any[] = []): Record<string, string> {
  return Object.fromEntries(
    options.filter((o) => o.description).map((o) => [o.label, String(o.description)]),
  );
}
export class CodexAgent implements Agent {
  private rpc?: JsonRpc;
  private ready?: Promise<void>;
  private threadId?: string;
  private turnId?: string;
  private threadModel?: string;
  private disposed = false;
  private workerThreads = new Set<string>();
  private reasoningWithSummary = new Set<string>();
  private pendingFileChanges = new Map<string, FileDiff[]>();
  constructor(
    private session: Session,
    private executable: string,
    private emit: EventSink,
    private options: CodexOptions = {},
  ) {}
  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.rpc = new JsonRpc(
      this.executable,
      ['app-server', '--listen', 'stdio://'],
      this.session.cwd,
      (message) => this.receive(message),
      (error) => {
        this.rpc = undefined;
        this.ready = undefined;
        this.turnId = undefined;
        if (!this.disposed) {
          this.emit({
            type: 'message',
            message: { id: randomUUID(), role: 'notice', text: error.message },
          });
          this.emit({ type: 'status', status: 'failed' });
        }
      },
    );
    const rpc = this.rpc;
    this.ready = (async () => {
      await rpc.request('initialize', {
        clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.5.0' },
        capabilities: { experimentalApi: true },
      });
      rpc.write({ method: 'initialized' });
      const result = this.session.nativeId
        ? await rpc.request('thread/resume', { threadId: this.session.nativeId })
        : await rpc.request('thread/start', {
            cwd: this.session.cwd,
            ...(this.options.delegate
              ? {
                  dynamicTools: [
                    {
                      type: 'function',
                      name: RUN_AGENT_TOOL,
                      description: RUN_AGENT_DESCRIPTION,
                      inputSchema: RUN_AGENT_JSON_SCHEMA,
                    },
                  ],
                }
              : {}),
          });
      this.threadId = result.thread.id;
      this.emit({ type: 'nativeId', id: result.thread.id });
      if (result.thread.name) this.emit({ type: 'title', title: result.thread.name });
      if (result.model) {
        this.threadModel = result.model;
        this.emit({ type: 'activeModel', model: result.model });
      }
      // A read of your plan's meters, not a model turn. API key accounts have none, so it may fail.
      void rpc
        .request('account/rateLimits/read', { excludeResetCreditDetails: true })
        .then((usage: any) => {
          const limits = codexLimits(usage?.rateLimits);
          if (limits.length) this.emit({ type: 'usage', limits });
        })
        .catch(() => {});
    })();
    return this.ready;
  }
  /** Sent once you have chosen a mode, because Codex keeps a mode for the turns after it. */
  private collaborationMode() {
    const { mode, model, effort } = this.session;
    if (!mode) return {};
    const settingsModel = model ?? this.threadModel;
    if (!settingsModel) {
      if (mode === 'plan') throw new Error('Codex did not say which model to plan with.');
      return {};
    }
    return {
      collaborationMode: {
        mode: mode === 'plan' ? 'plan' : 'default',
        settings: {
          model: settingsModel,
          reasoning_effort: effort ?? null,
          developer_instructions: null,
        },
      },
    };
  }
  async send(text: string, images?: ImageInput[]): Promise<void> {
    await this.connect();
    if (!this.rpc) throw new Error('Codex disconnected before the turn started.');
    const result = await this.rpc.request('turn/start', {
      threadId: this.threadId,
      input: [
        { type: 'text', text, text_elements: [] },
        ...(images ?? []).map((image) => ({ type: 'localImage', path: image.path })),
      ],
      ...this.collaborationMode(),
      // Asks for reasoning summaries, the part of Codex's thinking it makes available to clients.
      summary: 'auto',
      ...(this.session.model ? { model: this.session.model } : {}),
      ...(this.session.effort ? { effort: this.session.effort } : {}),
    });
    this.turnId = result.turn.id;
  }
  async interrupt(): Promise<void> {
    if (this.rpc && this.threadId && this.turnId)
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
    else {
      this.dispose();
    }
  }
  /** A child thread's transcript goes to that worker, never into the lead's. */
  private out(worker: string | undefined, event: TranscriptEvent): void {
    if (worker) this.emit({ type: 'worker', id: worker, inner: event });
    else this.emit(event);
  }
  private receive(message: RpcMessage): void {
    const { method, params: p } = message;
    if (!method || !p) return;
    if (message.id !== undefined) {
      this.serverRequest(message.id, method, p);
      return;
    }
    const foreign = Boolean(p.threadId && this.threadId && p.threadId !== this.threadId);
    if (foreign && !this.workerThreads.has(p.threadId)) return;
    const worker: string | undefined = foreign ? p.threadId : undefined;
    if (method === 'turn/started' && !worker) {
      this.turnId = p.turn.id;
      this.emit({ type: 'status', status: 'running' });
    }
    if (method === 'thread/tokenUsage/updated' && !worker) {
      const { last, modelContextWindow } = p.tokenUsage ?? {};
      if (last?.totalTokens >= 0 && modelContextWindow > 0)
        this.emit({
          type: 'usage',
          context: { used: last.totalTokens, max: modelContextWindow },
        });
    }
    if (method === 'account/rateLimits/updated') {
      const limits = codexLimits(p.rateLimits);
      if (limits.length) this.emit({ type: 'usage', limits });
    }
    if (method === 'thread/name/updated' && p.threadName) {
      if (worker) this.emit({ type: 'worker', id: worker, title: p.threadName });
      else this.emit({ type: 'title', title: p.threadName });
    }
    if (method === 'model/rerouted' && !worker && p.toModel) {
      this.emit({ type: 'activeModel', model: p.toModel });
      this.emit({
        type: 'message',
        message: {
          id: randomUUID(),
          role: 'notice',
          text: `Codex moved this turn from ${p.fromModel} to ${p.toModel}.`,
        },
      });
    }
    if (method === 'item/agentMessage/delta')
      this.out(worker, { type: 'delta', id: p.itemId, text: p.delta });
    if (method === 'item/plan/delta') {
      if (worker) this.out(worker, { type: 'delta', id: p.itemId, text: p.delta });
      else this.emit({ type: 'plan', text: p.delta, final: false });
    }
    if (method === 'item/reasoning/summaryTextDelta') {
      this.reasoningWithSummary.add(p.itemId);
      this.out(worker, { type: 'delta', id: p.itemId, role: 'thinking', text: p.delta });
    }
    if (method === 'item/reasoning/summaryPartAdded' && p.summaryIndex > 0)
      this.out(worker, { type: 'delta', id: p.itemId, role: 'thinking', text: '\n\n' });
    if (method === 'item/reasoning/textDelta' && !this.reasoningWithSummary.has(p.itemId))
      this.out(worker, { type: 'delta', id: p.itemId, role: 'thinking', text: p.delta });
    if (method === 'item/commandExecution/outputDelta')
      this.out(worker, { type: 'delta', id: p.itemId, role: 'tool', text: p.delta });
    if (method === 'item/fileChange/patchUpdated') {
      const diffs = fileDiffs(p.changes);
      this.pendingFileChanges.set(p.itemId, diffs);
      this.out(worker, { type: 'patch', id: p.itemId, tool: { diffs } });
    }
    if (method === 'item/started' || method === 'item/completed')
      this.item(p.item, method === 'item/completed', worker);
    if (method === 'turn/completed') {
      if (p.turn.error?.message)
        this.out(worker, {
          type: 'message',
          message: { id: randomUUID(), role: 'notice', text: p.turn.error.message },
        });
      const status: Status =
        p.turn.status === 'completed'
          ? 'completed'
          : p.turn.status === 'interrupted'
            ? 'interrupted'
            : 'failed';
      if (worker) this.emit({ type: 'worker', id: worker, status });
      else {
        this.turnId = undefined;
        this.emit({ type: 'status', status });
      }
    }
    if (method === 'error' && p.error?.message)
      this.out(worker, {
        type: 'message',
        message: { id: randomUUID(), role: 'notice', text: p.error.message },
      });
  }
  private tool(worker: string | undefined, id: string, tool: ToolInfo, text: string): void {
    this.out(worker, { type: 'message', message: { id, role: 'tool', text, tool } });
  }
  private item(item: any, completed: boolean, worker?: string): void {
    if (item.type === 'plan' && !worker) {
      if (completed) this.emit({ type: 'plan', text: item.text, final: true });
    } else if (item.type === 'imageGeneration') {
      void this.generatedImage(item, completed, worker);
    } else if (item.type === 'imageView') {
      if (completed) void this.viewedImage(item, worker);
    } else if (item.type === 'agentMessage' || item.type === 'plan') {
      if (completed)
        this.out(worker, {
          type: 'message',
          message: { id: item.id, role: 'assistant', text: item.text },
        });
    } else if (item.type === 'reasoning') {
      if (!completed) return;
      const text = [...(item.summary ?? [])].join('\n\n') || [...(item.content ?? [])].join('\n\n');
      if (text)
        this.out(worker, { type: 'message', message: { id: item.id, role: 'thinking', text } });
    } else if (item.type === 'commandExecution') {
      const failed = completed && typeof item.exitCode === 'number' && item.exitCode !== 0;
      const action = item.commandActions?.[0]?.type;
      const tool: ToolInfo = {
        kind: action === 'read' ? 'read' : action === 'search' ? 'search' : 'command',
        name: 'command',
        title: displayCommand(String(item.command ?? '')),
        status: toolStatus(item.status, completed, failed),
        ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
      };
      this.tool(worker, item.id, tool, item.aggregatedOutput ?? '');
    } else if (item.type === 'fileChange') {
      const diffs = fileDiffs(item.changes);
      this.pendingFileChanges.set(item.id, diffs);
      this.tool(
        worker,
        item.id,
        {
          kind: 'edit',
          name: 'fileChange',
          title: diffs.map((diff) => diff.path).join(', ') || 'files',
          status: toolStatus(item.status, completed),
          diffs,
        },
        '',
      );
    } else if (item.type === 'collabAgentToolCall') {
      for (const id of item.receiverThreadIds ?? []) {
        this.workerThreads.add(id);
        const state = item.agentsStates?.[id]?.status;
        const status: Status = ['completed', 'errored', 'shutdown', 'notFound'].includes(state)
          ? state === 'completed'
            ? 'completed'
            : 'failed'
          : 'running';
        this.emit({
          type: 'worker',
          id,
          ...(item.tool === 'spawnAgent' && item.prompt
            ? { title: deriveTitle(item.prompt) }
            : item.tool === 'spawnAgent'
              ? { title: `Worker · ${id.slice(0, 8)}` }
              : {}),
          status,
          ...(item.model ? { model: item.model } : {}),
        });
      }
      this.tool(
        worker,
        item.id,
        {
          kind: 'agent',
          name: String(item.tool),
          title: item.prompt
            ? deriveTitle(item.prompt)
            : (WORKER_TOOL_TITLES[item.tool] ?? String(item.tool)),
          status: toolStatus(item.status, completed),
          ...(item.tool === 'spawnAgent' && item.receiverThreadIds?.[0]
            ? { workerId: item.receiverThreadIds[0] }
            : {}),
        },
        item.prompt ?? '',
      );
    } else if (item.type === 'dynamicToolCall' && item.tool === RUN_AGENT_TOOL) {
      // The row is written by the request handler below, which knows the child thread.
    } else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
      this.tool(
        worker,
        item.id,
        {
          kind: 'other',
          name: String(item.tool),
          title: item.server ? `${item.server} · ${item.tool}` : String(item.tool),
          status: toolStatus(item.status, completed, Boolean(item.error)),
          input: JSON.stringify(item.arguments ?? {}, null, 2),
        },
        item.error?.message ?? (item.result ? JSON.stringify(item.result, null, 2) : ''),
      );
    } else if (item.type === 'webSearch') {
      this.tool(
        worker,
        item.id,
        {
          kind: 'web',
          name: 'webSearch',
          title: String(item.query ?? 'the web'),
          status: toolStatus(undefined, completed),
        },
        '',
      );
    } else if (completed && !['userMessage', 'hookPrompt', 'contextCompaction'].includes(item.type))
      this.tool(
        worker,
        item.id,
        { kind: 'other', name: String(item.type), title: String(item.type), status: 'completed' },
        JSON.stringify(item, null, 2),
      );
  }
  private imageMessage(worker: string | undefined, id: string, image: MessageImage): void {
    if (this.disposed) return;
    this.out(worker, { type: 'message', message: { id, role: 'image', text: '', image } });
  }
  /** Copied into the image store, so the webview never needs access to Codex's own folders. */
  private async generatedImage(item: any, completed: boolean, worker?: string): Promise<void> {
    const prompt = typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined;
    const base = prompt ? { prompt } : {};
    if (!completed) {
      this.imageMessage(worker, item.id, { status: 'generating', ...base });
      return;
    }
    const fail = (failure: string) =>
      this.imageMessage(worker, item.id, { status: 'failed', failure, ...base });
    if (item.failure)
      return fail(
        item.failure.type === 'usageLimitExceeded'
          ? 'Codex reached its image generation limit.'
          : `Codex could not generate this image: ${JSON.stringify(item.failure)}`,
      );
    try {
      const store = this.options.images;
      if (!store) throw new Error('This thread has nowhere to keep images.');
      let file: string;
      if (typeof item.savedPath === 'string') file = await store.copy(item.savedPath);
      else if (typeof item.result === 'string' && item.result)
        file = await store.save(Buffer.from(item.result, 'base64'));
      else throw new Error('Codex finished without giving this client the image.');
      this.imageMessage(worker, item.id, { status: 'ready', file, ...base });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  /** Shows an image Codex looked at, but only one from this workspace. */
  private async viewedImage(item: any, worker?: string): Promise<void> {
    const source = String(item.path ?? '');
    try {
      const inside = await resolveInside(this.session.cwd, path.relative(this.session.cwd, source));
      const store = this.options.images;
      if (!store) throw new Error('No image store.');
      const file = await store.copy(inside);
      this.imageMessage(worker, item.id, { status: 'ready', file, prompt: `Viewed ${source}` });
    } catch {
      if (this.disposed) return;
      this.tool(
        worker,
        item.id,
        { kind: 'read', name: 'imageView', title: source, status: 'completed' },
        '',
      );
    }
  }
  private runAgentCall(id: string | number, params: any): void {
    const rpc = this.rpc;
    const delegate = this.options.delegate;
    if (!rpc) return;
    const reply = (success: boolean, text: string) =>
      rpc.reply(id, { success, contentItems: [{ type: 'inputText', text }] });
    if (!delegate) {
      reply(false, 'Delegated agents cannot start further agents.');
      return;
    }
    let request: DelegateRequest;
    try {
      request = parseRunAgent(params.arguments);
    } catch (error) {
      reply(false, `Invalid ${RUN_AGENT_TOOL} arguments: ${String(error)}`);
      return;
    }
    const callId = String(params.callId ?? id);
    this.emit({
      type: 'message',
      message: {
        id: callId,
        role: 'tool',
        text: '',
        tool: {
          kind: 'agent',
          name: RUN_AGENT_TOOL,
          title: deriveTitle(request.prompt),
          status: 'running',
          input: request.prompt,
        },
      },
    });
    this.emit({
      type: 'approval',
      approval: {
        id: `run-agent-${id}`,
        title: runAgentApprovalTitle(request),
        detail: request.prompt,
      },
      respond: (allowed) => {
        if (!allowed) {
          this.emit({ type: 'patch', id: callId, tool: { status: 'declined' } });
          reply(false, 'Declined by the user.');
          return;
        }
        void delegate(request, (sessionId) =>
          this.emit({ type: 'patch', id: callId, tool: { workerId: sessionId } }),
        ).then(
          (result) => {
            const success = result.status === 'completed';
            this.emit({
              type: 'patch',
              id: callId,
              text: result.text,
              tool: { status: success ? 'completed' : 'failed' },
            });
            if (this.rpc === rpc) reply(success, runAgentResultText(request, result));
          },
          (error) => {
            this.emit({ type: 'patch', id: callId, tool: { status: 'failed' } });
            if (this.rpc === rpc) reply(false, String(error));
          },
        );
      },
    });
  }
  private serverRequest(id: string | number, method: string, params: any): void {
    const rpc = this.rpc;
    if (!rpc) return;
    const requestId = String(id);
    if (method === 'item/tool/call') {
      if (params.tool === RUN_AGENT_TOOL) this.runAgentCall(id, params);
      else
        rpc.reply(id, {
          success: false,
          contentItems: [{ type: 'inputText', text: `Unknown tool: ${params.tool}` }],
        });
    } else if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      const fileChange = method.includes('fileChange');
      const diffs = fileChange ? this.pendingFileChanges.get(params.itemId) : undefined;
      this.emit({
        type: 'approval',
        approval: {
          id: requestId,
          title: fileChange ? 'Apply file changes?' : 'Run command?',
          detail:
            [params.command && displayCommand(params.command), params.reason, params.cwd]
              .filter(Boolean)
              .join('\n') || (diffs?.length ? '' : JSON.stringify(params, null, 2)),
          ...(diffs?.length ? { diffs } : {}),
        },
        respond: (allowed) => rpc.reply(id, { decision: allowed ? 'accept' : 'decline' }),
      });
    } else if (method === 'item/tool/requestUserInput') {
      const questions: Question[] = params.questions.map((q: any) => ({
        id: q.id,
        prompt: q.question,
        options: (q.options ?? []).map((o: any) => o.label),
        details: optionDetails(q.options),
      }));
      this.emit({
        type: 'approval',
        approval: { id: requestId, title: 'Your input is needed', detail: '', questions },
        respond: (allowed, answers) => {
          rpc.reply(id, {
            answers: Object.fromEntries(
              questions.map((q) => [
                q.id,
                { answers: [allowed ? (answers[q.id] ?? '') : 'Declined by the user.'] },
              ]),
            ),
          });
        },
      });
    } else {
      rpc.write({
        id,
        error: {
          code: -32601,
          message: `Agent Workspace does not yet support ${method}. Use the native CLI for this capability.`,
        },
      });
      this.emit({
        type: 'message',
        message: {
          id: randomUUID(),
          role: 'notice',
          text: `Unsupported provider request: ${method}. No approval was granted. Stop and resume in the terminal if needed.`,
        },
      });
    }
  }
  dispose(): void {
    this.disposed = true;
    this.rpc?.dispose();
    this.rpc = undefined;
    this.ready = undefined;
  }
}
