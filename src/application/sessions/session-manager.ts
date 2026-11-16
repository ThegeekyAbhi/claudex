import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EXPLAIN_GUIDE, EXPLAIN_GUIDE_VERSION } from '../../shared/guidance/explain-guidance';
import { PLANNING_GUIDE, PLANNING_GUIDE_VERSION } from '../../shared/guidance/planning-guidance';
import type {
  AgentMode,
  DelegateRequest,
  DelegateResult,
  Provider,
  Session,
  SessionInput,
} from '../../shared/model';
import { createAgentFactory } from './agent-factory';
import { stampOwners } from './native-position';
import { SessionApprovals } from './session-approvals';
import { forkPoint, rewindPoint } from './session-branching';
import { SessionDelegation } from './session-delegation';
import { SessionFiles } from './session-files';
import { SessionPersistence } from './session-persistence';
import { type BuildOptions, SessionPlans } from './session-plans';
import type { AgentFactory, PlanFiles } from './session-types';
import { TurnLifecycle } from './turn-lifecycle';

export { createAgentFactory };
export type { Launcher, LauncherLookup } from './agent-factory';
export type { AgentFactory, PlanFiles } from './session-types';

export class Sessions extends EventEmitter {
  readonly sessions: Session[] = [];
  private disposed = false;
  private readonly approvals: SessionApprovals;
  private readonly delegation: SessionDelegation;
  private readonly files: SessionFiles;
  private readonly persistence: SessionPersistence;
  private readonly plans: SessionPlans;
  private readonly turns: TurnLifecycle;
  constructor(
    storage: string,
    factory: AgentFactory,
    /** Saving writes every thread, so it should not keep pace with streaming. */
    private saveDelayMs = 1500,
    plans?: PlanFiles,
    guidedPlanning: () => boolean = () => true,
    richExplanations: () => boolean = () => false,
  ) {
    super();
    this.persistence = new SessionPersistence({
      storage,
      sessions: this.sessions,
      log: (text) => console.warn(text),
    });
    this.files = new SessionFiles({
      isDisposed: () => this.disposed,
      changed: (full) => this.changed(full),
    });
    this.approvals = new SessionApprovals({
      get: (id) => this.get(id),
      changed: () => this.changed(),
      approve: (id, requestId, allowed, answers) => this.approve(id, requestId, allowed, answers),
      stopTurn: (id) => this.turns.stopTurn(id),
      flush: () => this.flush(),
      send: (id, text, input) => this.send(id, text, input),
      isDisposed: () => this.disposed,
    });
    this.plans = new SessionPlans({
      planFiles: plans,
      assertAvailable: (id) => this.approvals.assertAvailable(id),
      get: (id) => this.get(id),
      changed: () => this.changed(),
      currentPlanText: (session) => this.currentPlanText(session),
      keepPlanning: (id, feedback) => this.keepPlanning(id, feedback),
      approve: (id, requestId, allowed, answers) => this.approve(id, requestId, allowed, answers),
      send: (id, text, input) => this.send(id, text, input),
    });
    this.delegation = new SessionDelegation({
      sessions: this.sessions,
      get: (id) => this.get(id),
      create: (provider, cwd, workspace, title, parentId, profileId) =>
        this.create(provider, cwd, workspace, title, parentId, profileId),
      send: (id, text, input) => this.send(id, text, input),
    });
    this.turns = new TurnLifecycle({
      sessions: this.sessions,
      get: (id) => this.get(id),
      changed: (full) => this.changed(full),
      factory,
      guidedPlanning,
      richExplanations,
      guides: { EXPLAIN_GUIDE, EXPLAIN_GUIDE_VERSION, PLANNING_GUIDE, PLANNING_GUIDE_VERSION },
      delegate: (parentId, request, onStart) => this.delegate(parentId, request, onStart),
      interrupt: (id) => this.interrupt(id),
      flush: () => this.flush(),
      isDisposed: () => this.disposed,
      markDisposed: () => {
        this.disposed = true;
      },
      savePlanFile: (session, text) => this.plans.savePlanFile(session, text),
      approvals: this.approvals,
      delegation: this.delegation,
      files: this.files,
    });
  }
  get(id: string): Session {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) throw new Error('Session no longer exists.');
    return session;
  }
  continueChat(
    id: string,
    provider: Provider,
    profileId: string | undefined,
    context: string,
  ): void {
    this.approvals.assertAvailable(id);
    const session = this.get(id);
    if (
      session.observed ||
      session.inTerminal ||
      session.transition ||
      ['running', 'waiting'].includes(session.status)
    )
      throw new Error('Stop this thread before continuing with another agent.');
    this.turns.forget(id);
    // Earlier turns keep their agent's ids; the next agent never resumes or branches from them.
    stampOwners(session);
    session.previousAgents = [
      ...(session.previousAgents ?? []),
      { provider: session.provider, profileId: session.profileId, nativeId: session.nativeId },
    ];
    session.forkFrom = undefined;
    session.provider = provider;
    session.profileId = profileId;
    session.nativeId = undefined;
    session.nativeSyncedAt = undefined;
    session.continuationContext = context;
    session.model = undefined;
    session.effort = undefined;
    session.thinking = undefined;
    session.activeModel = undefined;
    session.adaptiveThinking = undefined;
    session.mode = undefined;
    session.reportedMode = undefined;
    session.nativeSettings = undefined;
    session.runtime = undefined;
    session.usage = undefined;
    if (session.plan)
      session.messages.push({
        id: randomUUID(),
        role: 'notice',
        text: `Plan before continuing (${session.plan.status}):\n\n${session.plan.text}`,
      });
    session.plan = undefined;
    session.status = 'idle';
    session.messages.push({
      id: randomUUID(),
      role: 'notice',
      text: `Continuing with ${profileId ?? provider}. Reviewed context will accompany your next message; provider permissions start fresh.`,
    });
    this.changed(true);
  }
  /** A thread can branch or rewind only while nothing is happening in it. */
  private assertSettled(session: Session, what: string): void {
    this.approvals.assertAvailable(session.id);
    if (
      session.observed ||
      session.inTerminal ||
      session.transition ||
      ['running', 'waiting'].includes(session.status)
    )
      throw new Error(`Stop this thread before you ${what}.`);
  }
  /**
   * A new thread with the same agent and the conversation through one turn. Your next message
   * there makes the CLI branch its own session; this thread and its CLI session are unchanged.
   */
  fork(id: string, messageId: string): Session {
    const source = this.get(id);
    this.assertSettled(source, 'fork it');
    const point = forkPoint(source, messageId);
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      provider: source.provider,
      ...(source.profileId ? { profileId: source.profileId } : {}),
      cwd: source.cwd,
      workspace: source.workspace,
      title: `${source.title} (fork)`,
      titleSource: 'user',
      status: 'idle',
      forkFrom: point.from,
      continuedFrom: source.id,
      // The copied turns may come from earlier agents; keeping the record keeps them theirs.
      ...(source.previousAgents?.length
        ? { previousAgents: structuredClone(source.previousAgents) }
        : {}),
      ...(source.model ? { model: source.model } : {}),
      ...(source.effort ? { effort: source.effort } : {}),
      ...(source.mode ? { mode: source.mode } : {}),
      // Copied rows are older than this, so reading the branch's history doesn't add them again.
      nativeSyncedAt: now,
      messages: [
        ...structuredClone(point.messages),
        {
          id: randomUUID(),
          role: 'notice',
          text: `Forked from “${source.title}”. Your next message continues from here; the original thread is unchanged.`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.push(session);
    this.changed(true);
    return session;
  }
  /**
   * Replaces your message and everything after it, then sends the new text. The CLI branches
   * from the turn before, so its earlier session stays on disk; files are never reverted.
   */
  rewind(id: string, messageId: string, text: string, input: SessionInput = {}): Promise<void> {
    const session = this.get(id);
    this.assertSettled(session, 'edit an earlier message');
    const point = rewindPoint(session, messageId);
    this.turns.forget(id);
    if (session.nativeId)
      session.previousAgents = [
        ...(session.previousAgents ?? []),
        { provider: session.provider, profileId: session.profileId, nativeId: session.nativeId },
      ];
    session.nativeId = undefined;
    session.forkFrom = point.from;
    session.messages.splice(point.keep);
    if (session.plan?.after && !session.messages.some((item) => item.id === session.plan?.after))
      session.plan = undefined;
    session.nativeSyncedAt = Date.now();
    session.messages.push({
      id: randomUUID(),
      role: 'notice',
      text: 'Edited an earlier message. Later turns were dropped from this thread; files the agent changed were not reverted.',
    });
    this.changed(true);
    return this.send(id, text, input);
  }
  remove(id: string): void {
    this.approvals.assertAvailable(id);
    const session = this.get(id);
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Stop this thread before deleting it.');
    for (const child of this.sessions) if (child.parentId === id) child.parentId = undefined;
    this.sessions.splice(this.sessions.indexOf(session), 1);
    this.files.forget(id);
    this.turns.forget(id);
    this.approvals.clear(id);
    this.changed();
  }
  create(
    provider: Provider,
    cwd: string,
    workspace: string,
    title: string,
    parentId?: string,
    profileId?: string,
  ): Session {
    const session: Session = {
      id: randomUUID(),
      provider,
      ...(profileId && profileId !== provider ? { profileId } : {}),
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
  setTitle(id: string, title: string): void {
    const session = this.get(id);
    session.title = title;
    session.titleSource = 'user';
    this.changed();
  }
  setModel(id: string, model: string | null, effort: string | null, adaptive?: boolean): void {
    this.approvals.assertAvailable(id);
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    session.model = model ?? undefined;
    session.effort = effort ?? undefined;
    session.adaptiveThinking = adaptive === false ? false : undefined;
    this.changed();
  }
  setMode(id: string, mode: AgentMode): void {
    this.approvals.assertAvailable(id);
    const session = this.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Wait for this turn or stop it before changing mode.');
    session.mode = mode;
    // The old report described the old mode. The next turn's report replaces it.
    delete session.reportedMode;
    this.changed();
  }
  changed(full = false): void {
    this.emit('change', full);
    if (this.disposed) return;
    this.persistence.scheduleSave({
      delayMs: this.saveDelayMs,
      flush: () => this.flush(),
      onError: (error) => this.emit('storageError', error),
    });
  }
  send(id: string, text: string, input: SessionInput = {}): Promise<void> {
    return this.turns.send(id, text, input);
  }
  interrupt(id: string): Promise<void> {
    return this.turns.interrupt(id);
  }
  disconnect(id: string): Promise<void> {
    return this.turns.disconnect(id);
  }
  dispose(): Promise<void> {
    return this.turns.dispose();
  }
  approve(id: string, requestId: string, allowed: boolean, answers: Record<string, string>): void {
    this.approvals.approve(id, requestId, allowed, answers);
  }
  allowInAuto(id: string, requestId: string): void {
    this.approvals.allowInAuto(id, requestId);
  }
  resumeInAuto(id: string, requestId: string): Promise<void> {
    return this.approvals.resumeInAuto(id, requestId);
  }
  currentPlanText(session: Session): Promise<string> {
    return this.plans.currentPlanText(session);
  }
  buildPlan(id: string, options?: BuildOptions): Promise<void> {
    return this.plans.buildPlan(id, options);
  }
  handOffPlan(id: string, notes?: string): Promise<string> {
    return this.plans.handOffPlan(id, notes);
  }
  keepPlanning(id: string, feedback?: string): void {
    this.plans.keepPlanning(id, feedback);
  }
  delegate(
    parentId: string,
    request: DelegateRequest,
    onStart?: (sessionId: string) => void,
    input?: SessionInput,
  ): Promise<DelegateResult> {
    return this.delegation.delegate(parentId, request, onStart, input);
  }
  load(): Promise<void> {
    return this.persistence.load();
  }
  flush(): Promise<void> {
    return this.persistence.flush();
  }
}
