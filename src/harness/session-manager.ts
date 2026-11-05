import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  type FileDiff,
  type Provider,
  restoreSessions,
  type Session,
  type SessionInput,
  type SkillRequest,
  TERMINAL_STATUSES,
} from '../core/model';
import { ClaudeAgent } from '../providers/claude/adapter';
import { CodexAgent } from '../providers/codex/adapter';
import type { ImageStore } from '../providers/shared/image-store';
import { FileObserver } from './file-observer';
import { PLANNING_GUIDE, PLANNING_GUIDE_VERSION } from './planning-guidance';

export type AgentFactory = (session: Session, emit: EventSink, delegate?: Delegate) => Agent;
export interface PlanFiles {
  save(session: Session, text: string): Promise<string>;
  read(file: string): Promise<string>;
}
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
  private observers = new Map<
    string,
    {
      observer: FileObserver;
      start: number;
      finished: Set<string>;
      nativeSeen: Set<string>;
      closed?: boolean;
      note?: string;
    }
  >();
  private transitions = new Map<string, { cancelled: boolean }>();
  constructor(
    private storage: string,
    private factory: AgentFactory,
    /** Saving writes every thread, so it should not keep pace with streaming. */
    private saveDelayMs = 1500,
    private plans?: PlanFiles,
    private guidedPlanning: () => boolean = () => true,
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
  private assertAvailable(id: string): void {
    if (this.transitions.has(id)) throw new Error('Wait for the Auto transition or stop it.');
  }
  remove(id: string): void {
    this.assertAvailable(id);
    const session = this.get(id);
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Stop this thread before deleting it.');
    for (const child of this.sessions) if (child.parentId === id) child.parentId = undefined;
    this.sessions.splice(this.sessions.indexOf(session), 1);
    this.observers.delete(id);
    this.agents.get(id)?.dispose();
    this.agents.delete(id);
    this.generations.delete(id);
    this.approvals.delete(id);
    this.changed();
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
    this.assertAvailable(id);
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Wait for this turn or stop it before sending another message.');
    const guided = session.mode === 'plan' && this.guidedPlanning();
    session.messages.push({
      id: randomUUID(),
      role: 'user',
      text,
      ...(guided ? { planningGuideVersion: PLANNING_GUIDE_VERSION } : {}),
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
      await this.observers.get(id)?.observer.flush();
      const observer = await FileObserver.start(session.cwd);
      if (this.disposed || this.generations.get(id) !== generation) return;
      this.observers.set(id, {
        observer,
        start: session.messages.length,
        finished: new Set(),
        nativeSeen: new Set(),
      });
      await agent.send(
        [text, input.context, guided ? PLANNING_GUIDE : undefined].filter(Boolean).join('\n\n'),
        input.images,
        input.skills,
      );
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
      const id =
        event.type === 'message' ? event.message.id : event.type === 'patch' ? event.id : undefined;
      const tool = id ? session.messages.find((message) => message.id === id)?.tool : undefined;
      const observer = this.observers.get(session.id);
      if (
        id &&
        tool &&
        tool.status !== 'running' &&
        tool.status !== 'declined' &&
        (tool.kind === 'command' || tool.kind === 'edit') &&
        !observer?.finished.has(id)
      ) {
        observer?.finished.add(id);
        this.captureFiles(session, id);
      }
      if (event.type === 'status' && TERMINAL_STATUSES.includes(event.status))
        this.captureFiles(session, undefined, true);
      if (event.type === 'plan' && event.final) this.savePlanFile(session, event.text);
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
  private captureFiles(session: Session, after?: string, final = false): void {
    const state = this.observers.get(session.id);
    if (!state || state.closed) return;
    const native: FileDiff[] = [];
    for (const message of session.messages.slice(state.start)) {
      const tool = message.tool;
      if (!tool || tool.diffSource || tool.status !== 'completed' || !tool.diffs?.length) continue;
      const key = `${message.id}:${JSON.stringify(tool.diffs)}`;
      if (state.nativeSeen.has(key)) continue;
      state.nativeSeen.add(key);
      native.push(...tool.diffs);
    }
    state.observer.checkpoint(({ diffs, note }) => {
      if (this.disposed || this.observers.get(session.id) !== state) return;
      const relevant = after || state.finished.size || diffs.length;
      const freshNote = relevant && note !== state.note ? note : undefined;
      state.note = note;
      if (!diffs.length && !freshNote) return;
      const message: Session['messages'][number] = {
        id: randomUUID(),
        role: 'tool',
        text: '',
        tool: {
          kind: 'other',
          name: 'filesystemChanges',
          title: 'Observed file changes',
          status: 'completed',
          diffSource: 'filesystem',
          diffs,
          captureNote: freshNote,
        },
      };
      const index = after ? session.messages.findIndex((item) => item.id === after) : -1;
      if (index >= 0) session.messages.splice(index + 1, 0, message);
      else {
        const nextUser = session.messages.findIndex(
          (item, index) => index >= state.start && item.role === 'user',
        );
        if (nextUser >= 0) session.messages.splice(nextUser, 0, message);
        else session.messages.push(message);
      }
      this.changed(true);
    }, native);
    if (final) {
      state.closed = true;
      state.nativeSeen.clear();
      state.observer.release();
    }
  }
  approve(id: string, requestId: string, allowed: boolean, answers: Record<string, string>): void {
    this.assertAvailable(id);
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
    const transition = this.transitions.get(id);
    if (transition) {
      transition.cancelled = true;
      return;
    }
    await this.stopTurn(id);
  }
  private async stopTurn(id: string): Promise<void> {
    const session = this.get(id);
    if (session.observed) throw new Error('Stop this worker through its main agent.');
    const agent = this.agents.get(id);
    // A stopped lead cannot use its delegates' answers, so they stop with it.
    const children = await Promise.allSettled(
      this.activeDelegates(id).map((child) => this.interrupt(child.id)),
    );
    let stopped = false;
    try {
      if (agent) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            agent.interrupt(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Could not confirm the turn stopped within 15 seconds.')),
                15_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      if (children.some((child) => child.status === 'rejected'))
        throw new Error('A delegated turn could not be confirmed stopped.');
      stopped = true;
    } finally {
      this.generations.delete(id);
      this.agents.delete(id);
      agent?.dispose();
      this.approvals.delete(id);
      delete session.approval;
      session.status = stopped ? 'interrupted' : 'failed';
      this.captureFiles(session, undefined, true);
      await this.observers.get(id)?.observer.flush();
      for (const message of session.messages) {
        if (message.tool?.status === 'running') message.tool.status = 'interrupted';
      }
      this.settle(id);
      this.changed();
    }
  }
  async resumeInAuto(id: string, requestId: string): Promise<void> {
    this.assertAvailable(id);
    const session = this.get(id);
    const request = this.approvals.get(id)?.get(requestId)?.approval;
    if (
      session.observed ||
      !session.nativeId ||
      session.status !== 'waiting' ||
      !request ||
      request.origin !== 'provider' ||
      request.questions ||
      request.kind === 'plan'
    )
      throw new Error('This provider request is no longer eligible for Auto.');
    if (session.provider === 'codex' && session.nativeSettings?.approvalPolicy !== 'on-request')
      throw new Error(
        'Native Auto needs an on-request approval policy. Keep this thread’s permissions or start a compatible thread.',
      );
    const transition = { cancelled: false };
    this.transitions.set(id, transition);
    session.transition = 'stopping';
    this.changed();
    try {
      await this.stopTurn(id);
      if (transition.cancelled || this.disposed) return;
      session.mode = 'auto';
      delete session.reportedMode;
      session.transition = 'resuming';
      this.changed();
      await this.flush();
      if (transition.cancelled || this.disposed) return;
      // Release only after persistence succeeds; send reserves the running session synchronously.
      this.transitions.delete(id);
      delete session.transition;
      await this.send(
        id,
        'Continue the existing task from the interrupted turn. Check current state before retrying any interrupted action.',
      );
    } catch (error) {
      session.status = 'failed';
      applyTranscript(session, {
        type: 'message',
        message: {
          id: randomUUID(),
          role: 'notice',
          text: `Could not ${session.transition === 'stopping' ? 'confirm the turn stopped' : 'resume in Auto'}. No automatic retry was started. ${String(error)}`,
        },
      });
    } finally {
      // A resumed provider can ask again before its send promise settles. Never clear a newer transition.
      if (this.transitions.get(id) === transition) {
        this.transitions.delete(id);
        delete session.transition;
      }
      this.changed();
    }
  }
  async disconnect(id: string): Promise<void> {
    this.assertAvailable(id);
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
    this.assertAvailable(id);
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    session.model = model ?? undefined;
    session.effort = effort ?? undefined;
    session.adaptiveThinking = adaptive === false ? false : undefined;
    this.changed();
  }
  setMode(id: string, mode: AgentMode): void {
    this.assertAvailable(id);
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Wait for this turn or stop it before changing mode.');
    session.mode = mode;
    // The old report described the old mode. The next turn's report replaces it.
    delete session.reportedMode;
    this.changed();
  }
  /**
   * Your decision to build. A provider still waiting on its plan request gets that answer;
   * otherwise building is an ordinary next turn. Either way this says nothing about the result.
   */
  /** Never holds up the agent, and a failed write only costs the file, not the plan. */
  private savePlanFile(session: Session, text: string): void {
    this.plans
      ?.save(session, text)
      .then((file) => {
        if (session.plan?.text !== text) return;
        session.plan.file = file;
        this.changed();
      })
      .catch((error) =>
        applyTranscript(session, {
          type: 'message',
          message: {
            id: randomUUID(),
            role: 'notice',
            text: `The plan couldn’t be saved as a file: ${String(error)}`,
          },
        }),
      );
  }
  /** The plan as you left it: the file if there is one, because you may have edited it. */
  async currentPlanText(session: Session): Promise<string> {
    if (!session.plan) throw new Error('This thread has no plan.');
    if (!session.plan.file || !this.plans) return session.plan.text;
    const text = await this.plans.read(session.plan.file).catch(() => session.plan?.text ?? '');
    if (!text.trim()) throw new Error('The plan file is empty.');
    return text;
  }
  async buildPlan(id: string, mode: 'agent' | 'auto' = 'agent'): Promise<void> {
    this.assertAvailable(id);
    const session = this.get(id);
    if (!session.plan) throw new Error('This thread has no plan to build.');
    const waiting = () => {
      const request = session.approval?.kind === 'plan' ? session.approval : undefined;
      if (!request && (session.status === 'running' || session.status === 'waiting'))
        throw new Error('Wait for this turn or stop it before building the plan.');
      return request;
    };
    waiting();
    const text = await this.currentPlanText(session);
    const request = waiting();
    const edited = text.trim() !== session.plan.text.trim();
    session.plan.text = text;
    session.mode = mode;
    delete session.reportedMode;
    session.plan.status = 'approved';
    if (request) this.approve(id, request.id, true, edited ? { plan: text } : {});
    else
      await this.send(
        id,
        edited ? `Implement this plan. I edited it:\n\n${text}` : 'Implement the plan.',
      );
  }
  /** The prompt for another agent, which hasn't seen this thread. */
  async handOffPlan(id: string): Promise<string> {
    const session = this.get(id);
    const text = await this.currentPlanText(session);
    if (session.approval?.kind === 'plan') this.keepPlanning(id);
    if (session.plan) session.plan.status = 'approved';
    this.changed();
    return `Implement this plan:\n\n${text}`;
  }
  /** Declines a pending plan request, so the agent stays in plan mode for your feedback. */
  /** What you type while a plan waits is your feedback on it, and goes back with the answer. */
  keepPlanning(id: string, feedback?: string): void {
    const session = this.get(id);
    if (session.approval?.kind !== 'plan') return;
    if (feedback)
      applyTranscript(session, {
        type: 'message',
        message: { id: randomUUID(), role: 'user', text: feedback },
      });
    this.approve(id, session.approval.id, false, feedback ? { feedback } : {});
  }
  changed(full = false): void {
    this.emit('change', full);
    if (this.disposed) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      void this.flush().catch((error) => this.emit('storageError', error));
    }, this.saveDelayMs);
  }
  private serialize(): string {
    return JSON.stringify({
      version: 1,
      sessions: this.sessions.map(({ approval, transition, ...session }) => session),
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
    const write = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.storage, { recursive: true });
        const temporary = path.join(this.storage, 'sessions.json.tmp');
        await writeFile(temporary, data, { mode: 0o600 });
        await rename(temporary, path.join(this.storage, 'sessions.json'));
        this.lastSaved = data;
      });
    this.saveQueue = write;
    return write;
  }
  async dispose(): Promise<void> {
    for (const agent of this.agents.values()) agent.dispose();
    for (const session of this.sessions) {
      if (session.status === 'running' || session.status === 'waiting')
        this.captureFiles(session, undefined, true);
    }
    await Promise.all([...this.observers.values()].map(({ observer }) => observer.flush()));
    this.disposed = true;
    this.observers.clear();
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
  skills?: (session: Session) => SkillRequest[],
): AgentFactory {
  const resolve = (provider: Provider, command?: ClaudeCommand): Launcher => {
    const value = paths(provider, command);
    return typeof value === 'string' ? { executable: value } : value;
  };
  return (session, emit, delegate) => {
    if (session.provider === 'codex')
      return new CodexAgent(session, resolve('codex').executable, emit, {
        delegate,
        images,
        skills: () => skills?.(session) ?? [],
      });
    const launcher = resolve('claude', session.claudeCommand);
    return new ClaudeAgent(session, launcher.executable, emit, {
      env: launcher.env,
      delegate,
      skills: () => skills?.(session) ?? [],
    });
  };
}
