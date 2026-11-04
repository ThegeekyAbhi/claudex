import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageStore } from './attachments';
import {
  type Agent,
  type AgentEvent,
  type AgentMode,
  agentTarget,
  applyEvent,
  applyTranscript,
  type ClaudeCommand,
  type Delegate,
  type DelegateRequest,
  type DelegateResult,
  deriveTitle,
  type EventSink,
  type Provider,
  restoreSessions,
  type Session,
  type SessionInput,
  TERMINAL_STATUSES,
} from './model';
import { ClaudeAgent } from './providers/claude';
import { CodexAgent } from './providers/codex';

export type AgentFactory = (session: Session, emit: EventSink, delegate?: Delegate) => Agent;
export class Sessions extends EventEmitter {
  readonly sessions: Session[] = [];
  private agents = new Map<string, Agent>();
  private generations = new Map<string, symbol>();
  private approvals = new Map<string, Map<string, Extract<AgentEvent, { type: 'approval' }>>>();
  private saveQueue: Promise<void> = Promise.resolve();
  private lastSaved?: string;
  private saveTimer?: NodeJS.Timeout;
  private waiters = new Map<string, () => void>();
  private disposed = false;
  constructor(
    private storage: string,
    private factory: AgentFactory,
  ) {
    super();
  }
  async load(): Promise<void> {
    try {
      this.sessions.push(
        ...restoreSessions(
          JSON.parse(await readFile(path.join(this.storage, 'sessions.json'), 'utf8')),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `Could not restore sessions; stored files were preserved. ${String(error)}`,
        );
    }
    this.lastSaved = this.serialize();
  }
  get(id: string): Session {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) throw new Error('Session no longer exists.');
    return session;
  }
  create(
    provider: Provider,
    cwd: string,
    workspace: string,
    title: string,
    parentId?: string,
    claudeCommand?: ClaudeCommand,
  ): Session {
    const session: Session = {
      id: randomUUID(),
      provider,
      claudeCommand: provider === 'claude' ? (claudeCommand ?? 'claude') : undefined,
      cwd,
      workspace,
      title,
      titleSource: 'prompt',
      parentId,
      status: 'idle',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.push(session);
    this.changed();
    return session;
  }
  async send(id: string, text: string, input: SessionInput = {}): Promise<void> {
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Wait for this turn or stop it before sending another message.');
    session.messages.push({
      id: randomUUID(),
      role: 'user',
      text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
    session.status = 'running';
    this.changed();
    let agent = this.agents.get(id);
    const generation = this.generations.get(id) ?? Symbol(id);
    this.generations.set(id, generation);
    try {
      if (!agent) {
        agent = this.factory(
          session,
          (event) => {
            if (this.generations.get(id) === generation) this.receive(session, event);
          },
          // A delegated agent cannot start another, so delegation cannot chain or loop.
          session.delegated ? undefined : (request, onStart) => this.delegate(id, request, onStart),
        );
        this.agents.set(id, agent);
      }
      await agent.send(input.context ? `${text}\n\n${input.context}` : text, input.images);
    } catch (error) {
      if (this.generations.get(id) !== generation) return;
      this.agents.delete(id);
      this.generations.delete(id);
      agent?.dispose();
      this.receive(session, {
        type: 'message',
        message: { id: randomUUID(), role: 'notice', text: String(error) },
      });
      this.receive(session, { type: 'status', status: 'failed' });
    }
  }
  /** Runs one agent as a child thread. It uses its own provider session and its own approvals. */
  async delegate(
    parentId: string,
    request: DelegateRequest,
    onStart?: (sessionId: string) => void,
    input?: SessionInput,
  ): Promise<DelegateResult> {
    const parent = this.get(parentId);
    const target = agentTarget(request.agent);
    const child = this.create(
      target.provider,
      parent.cwd,
      parent.workspace,
      deriveTitle(request.prompt),
      parent.id,
      target.command,
    );
    child.delegated = true;
    child.model = request.model;
    child.effort = request.effort;
    onStart?.(child.id);
    const finished = new Promise<void>((resolve) => this.waiters.set(child.id, resolve));
    await this.send(child.id, request.prompt, input);
    await finished;
    return {
      sessionId: child.id,
      status: child.status,
      text: child.messages.filter((message) => message.role === 'assistant').at(-1)?.text ?? '',
    };
  }
  private settle(id: string): void {
    const resolve = this.waiters.get(id);
    if (!resolve) return;
    this.waiters.delete(id);
    resolve();
  }
  private activeDelegates(parentId: string): Session[] {
    return this.sessions.filter(
      (item) =>
        item.parentId === parentId &&
        item.delegated &&
        (item.status === 'running' || item.status === 'waiting'),
    );
  }
  private receiveWorker(session: Session, event: Extract<AgentEvent, { type: 'worker' }>): void {
    let worker = this.sessions.find(
      (item) => item.observed && item.nativeId === event.id && item.parentId === session.id,
    );
    if (!worker) {
      worker = {
        ...session,
        id: randomUUID(),
        nativeId: event.id,
        observed: true,
        delegated: undefined,
        model: undefined,
        effort: undefined,
        activeModel: undefined,
        mode: undefined,
        plan: undefined,
        parentId: session.id,
        title: event.title ?? 'Worker',
        titleSource: 'provider',
        status: event.status ?? 'running',
        messages: [],
        approval: undefined,
      };
      this.sessions.push(worker);
    }
    if (event.title) worker.title = event.title;
    if (event.status) worker.status = event.status;
    if (event.model) worker.activeModel = event.model;
    worker.updatedAt = Date.now();
    if (event.inner) applyTranscript(worker, event.inner);
  }
  private receive(session: Session, event: AgentEvent): void {
    if (this.disposed) return;
    if (event.type === 'worker') this.receiveWorker(session, event);
    else if (event.type === 'title') {
      if (session.titleSource !== 'user' && session.titleSource !== undefined) {
        session.title = event.title;
        session.titleSource = 'provider';
      }
    } else {
      if (event.type === 'approval') {
        const pending = this.approvals.get(session.id) ?? new Map();
        pending.set(event.approval.id, event);
        this.approvals.set(session.id, pending);
      }
      applyEvent(session, event);
      if (event.type === 'status' && TERMINAL_STATUSES.includes(event.status))
        this.approvals.delete(session.id);
    }
    const pending = this.approvals.get(session.id);
    if (pending?.size) {
      session.approval = pending.values().next().value?.approval;
      session.status = 'waiting';
    }
    if (TERMINAL_STATUSES.includes(session.status) && event.type === 'status')
      this.settle(session.id);
    this.changed();
  }
  approve(id: string, requestId: string, allowed: boolean, answers: Record<string, string>): void {
    const session = this.get(id);
    const pending = this.approvals.get(id);
    const request = pending?.get(requestId);
    if (!pending || !request) throw new Error('This request is no longer pending.');
    pending.delete(requestId);
    const next = pending.values().next().value;
    session.approval = next?.approval;
    session.status = next ? 'waiting' : 'running';
    request.respond(allowed, answers);
    this.changed();
  }
  async interrupt(id: string): Promise<void> {
    const session = this.get(id);
    if (session.observed) throw new Error('Stop this worker through its main agent.');
    const agent = this.agents.get(id);
    // A stopped lead cannot use its delegates' answers, so they stop with it.
    await Promise.allSettled(this.activeDelegates(id).map((child) => this.interrupt(child.id)));
    try {
      if (agent) await agent.interrupt();
    } finally {
      this.generations.delete(id);
      this.agents.delete(id);
      agent?.dispose();
      this.approvals.delete(id);
      delete session.approval;
      session.status = 'interrupted';
      this.settle(id);
      this.changed();
    }
  }
  async disconnect(id: string): Promise<void> {
    const agent = this.agents.get(id);
    this.agents.delete(id);
    this.generations.delete(id);
    agent?.dispose();
    this.approvals.delete(id);
    delete this.get(id).approval;
    this.get(id).status = 'interrupted';
    this.settle(id);
    await this.flush();
  }
  setTitle(id: string, title: string): void {
    const session = this.get(id);
    session.title = title;
    session.titleSource = 'user';
    this.changed();
  }
  setModel(id: string, model: string | null, effort: string | null, adaptive?: boolean): void {
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    session.model = model ?? undefined;
    session.effort = effort ?? undefined;
    session.adaptiveThinking = adaptive === false ? false : undefined;
    this.changed();
  }
  setMode(id: string, mode: AgentMode): void {
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Wait for this turn or stop it before changing mode.');
    session.mode = mode;
    this.changed();
  }
  /**
   * Your decision to build. A provider still waiting on its plan request gets that answer;
   * otherwise building is an ordinary next turn. Either way this says nothing about the result.
   */
  async buildPlan(id: string): Promise<void> {
    const session = this.get(id);
    if (!session.plan) throw new Error('This thread has no plan to build.');
    const request = session.approval?.kind === 'plan' ? session.approval : undefined;
    if (!request && (session.status === 'running' || session.status === 'waiting'))
      throw new Error('Wait for this turn or stop it before building the plan.');
    session.mode = 'agent';
    session.plan.status = 'approved';
    if (request) this.approve(id, request.id, true, {});
    else await this.send(id, 'Implement the plan.');
  }
  /** Declines a pending plan request, so the agent stays in plan mode for your feedback. */
  keepPlanning(id: string): void {
    const session = this.get(id);
    if (session.approval?.kind === 'plan') this.approve(id, session.approval.id, false, {});
  }
  changed(): void {
    this.emit('change');
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      void this.flush().catch((error) => this.emit('storageError', error));
    }, 400);
  }
  private serialize(): string {
    return JSON.stringify({
      version: 1,
      sessions: this.sessions.map(({ approval, ...session }) => session),
    });
  }
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const data = this.serialize();
    // Windows with no folder share a store, so an idle one must not overwrite with its old copy.
    if (data === this.lastSaved) return this.saveQueue;
    this.lastSaved = data;
    const write = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.storage, { recursive: true });
        const temporary = path.join(this.storage, 'sessions.json.tmp');
        await writeFile(temporary, data, { mode: 0o600 });
        await rename(temporary, path.join(this.storage, 'sessions.json'));
      });
    this.saveQueue = write;
    return write;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const agent of this.agents.values()) agent.dispose();
    for (const session of this.sessions)
      if (session.status === 'running' || session.status === 'waiting') {
        session.status = 'interrupted';
        delete session.approval;
      }
    for (const id of [...this.waiters.keys()]) this.settle(id);
    this.agents.clear();
    this.generations.clear();
    this.approvals.clear();
    await this.flush();
  }
}
export interface Launcher {
  executable: string;
  /** Extra environment for the CLI, such as CLAUDE_CONFIG_DIR for a second account. */
  env?: Record<string, string>;
}
export function createAgentFactory(
  paths: (provider: Provider, claudeCommand?: ClaudeCommand) => string | Launcher,
  images?: ImageStore,
): AgentFactory {
  const resolve = (provider: Provider, command?: ClaudeCommand): Launcher => {
    const value = paths(provider, command);
    return typeof value === 'string' ? { executable: value } : value;
  };
  return (session, emit, delegate) => {
    if (session.provider === 'codex')
      return new CodexAgent(session, resolve('codex').executable, emit, { delegate, images });
    const launcher = resolve('claude', session.claudeCommand);
    return new ClaudeAgent(session, launcher.executable, emit, { env: launcher.env, delegate });
  };
}
