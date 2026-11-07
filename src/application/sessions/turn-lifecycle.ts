import { randomUUID } from 'node:crypto';
import { FileObserver } from '../../infrastructure/file-observer';
import {
  type Agent,
  type AgentEvent,
  applyEvent,
  applyTranscript,
  type DelegateRequest,
  type DelegateResult,
  type Session,
  type SessionInput,
  TERMINAL_STATUSES,
} from '../../shared/model';
import type { SessionApprovals } from './session-approvals';
import type { SessionDelegation } from './session-delegation';
import type { SessionFiles } from './session-files';
import type { AgentFactory } from './session-types';

interface Dependencies {
  sessions: Session[];
  get(id: string): Session;
  changed(full?: boolean): void;
  factory: AgentFactory;
  guidedPlanning(): boolean;
  richExplanations(): boolean;
  guides: {
    PLANNING_GUIDE: string;
    PLANNING_GUIDE_VERSION: string;
    EXPLAIN_GUIDE: string;
    EXPLAIN_GUIDE_VERSION: string;
  };
  delegate(
    parentId: string,
    request: DelegateRequest,
    onStart?: (sessionId: string) => void,
  ): Promise<DelegateResult>;
  interrupt(id: string): Promise<void>;
  flush(): Promise<void>;
  isDisposed(): boolean;
  markDisposed(): void;
  savePlanFile(session: Session, text: string): void;
  approvals: Pick<
    SessionApprovals,
    'assertAvailable' | 'record' | 'pendingFor' | 'clear' | 'clearAll' | 'cancelTransition'
  >;
  delegation: Pick<SessionDelegation, 'activeDelegates' | 'notifySettled' | 'settleAll'>;
  files: Pick<
    SessionFiles,
    'observe' | 'flush' | 'flushAll' | 'forgetAll' | 'captureFiles' | 'captureAfterTool'
  >;
}

/**
 * The CLI writes a turn's last records just after it reports the turn over, so those few seconds
 * still belong to the turn run here and must not come back as "From the terminal".
 */
export const SETTLE_GRACE_MS = 2_000;
/** Every way a turn run here can end goes through this, so its records are never read back. */
export function settleNative(session: Session, now = Date.now()): void {
  if (session.nativeId)
    session.nativeSyncedAt = Math.max(session.nativeSyncedAt ?? 0, now + SETTLE_GRACE_MS);
}

export class TurnLifecycle {
  private agents = new Map<string, Agent>();
  private generations = new Map<string, symbol>();
  constructor(private deps: Dependencies) {}
  forget(id: string): void {
    this.agents.get(id)?.dispose();
    this.agents.delete(id);
    this.generations.delete(id);
  }
  async send(id: string, text: string, input: SessionInput = {}): Promise<void> {
    this.deps.approvals.assertAvailable(id);
    const session = this.deps.get(id);
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.status === 'running' || session.status === 'waiting')
      throw new Error('Wait for this turn or stop it before sending another message.');
    // With a skill, a guide would become part of the skill's arguments.
    const guides = !input.skills?.length;
    const guided = guides && session.mode === 'plan' && this.deps.guidedPlanning();
    const explained = guides && session.mode === 'ask' && this.deps.richExplanations();
    session.messages.push({
      id: randomUUID(),
      role: 'user',
      text,
      ...(guided ? { planningGuideVersion: this.deps.guides.PLANNING_GUIDE_VERSION } : {}),
      ...(explained ? { explainGuideVersion: this.deps.guides.EXPLAIN_GUIDE_VERSION } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
    session.status = 'running';
    this.deps.changed();
    let agent = this.agents.get(id);
    const generation = this.generations.get(id) ?? Symbol(id);
    this.generations.set(id, generation);
    try {
      if (!agent) {
        agent = this.deps.factory(
          session,
          (event) => {
            if (this.generations.get(id) === generation) this.receive(session, event);
          },
          // A delegated agent cannot start another, so delegation cannot chain or loop.
          session.delegated
            ? undefined
            : (request, onStart) => this.deps.delegate(id, request, onStart),
        );
        this.agents.set(id, agent);
      }
      await this.deps.files.flush(id);
      const observer = await FileObserver.start(session.cwd);
      if (this.deps.isDisposed() || this.generations.get(id) !== generation) return;
      this.deps.files.observe(id, observer, session.messages.length);
      await agent.send(
        [
          text,
          input.context,
          session.continuationContext,
          guided ? this.deps.guides.PLANNING_GUIDE : undefined,
          explained ? this.deps.guides.EXPLAIN_GUIDE : undefined,
        ]
          .filter(Boolean)
          .join('\n\n'),
        input.images,
        input.skills,
      );
      if (this.deps.get(id).status === 'completed') session.continuationContext = undefined;
      // The CLI accepted the history, so the next switch back sends only what follows it.
      if (input.syncs?.length && this.generations.get(id) === generation) {
        session.synced = { ...session.synced };
        for (const { from, through } of input.syncs) session.synced[from] = through;
        this.deps.changed();
      }
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
  receiveWorker(session: Session, event: Extract<AgentEvent, { type: 'worker' }>): void {
    let worker = this.deps.sessions.find(
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
      this.deps.sessions.push(worker);
    }
    if (event.title) worker.title = event.title;
    if (event.status) worker.status = event.status;
    if (event.model) worker.activeModel = event.model;
    worker.updatedAt = Date.now();
    if (event.inner) applyTranscript(worker, event.inner);
  }
  receive(session: Session, event: AgentEvent): void {
    if (this.deps.isDisposed()) return;
    if (event.type === 'worker') this.receiveWorker(session, event);
    else if (event.type === 'title') {
      if (session.titleSource !== 'user' && session.titleSource !== undefined) {
        session.title = event.title;
        session.titleSource = 'provider';
      }
    } else {
      if (event.type === 'approval') {
        this.deps.approvals.record(session.id, event);
      }
      applyEvent(session, event);
      const id =
        event.type === 'message' ? event.message.id : event.type === 'patch' ? event.id : undefined;
      const tool = id ? session.messages.find((message) => message.id === id)?.tool : undefined;
      this.deps.files.captureAfterTool(session, id, tool);
      if (event.type === 'status' && TERMINAL_STATUSES.includes(event.status))
        this.deps.files.captureFiles(session, undefined, true);
      if (event.type === 'plan' && event.final) this.deps.savePlanFile(session, event.text);
      if (event.type === 'status' && TERMINAL_STATUSES.includes(event.status))
        this.deps.approvals.clear(session.id);
    }
    const pending = this.deps.approvals.pendingFor(session.id);
    if (pending) {
      session.approval = pending;
      session.status = 'waiting';
    }
    // A turn run here is in the CLI's transcript too; only what's recorded after it is new.
    if (TERMINAL_STATUSES.includes(session.status) && event.type === 'status')
      settleNative(session);
    if (TERMINAL_STATUSES.includes(session.status) && event.type === 'status')
      this.deps.delegation.notifySettled(session.id);
    this.deps.changed();
  }
  async interrupt(id: string): Promise<void> {
    if (this.deps.approvals.cancelTransition(id)) return;
    await this.stopTurn(id);
  }
  async stopTurn(id: string): Promise<void> {
    const session = this.deps.get(id);
    if (session.observed) throw new Error('Stop this worker through its main agent.');
    const agent = this.agents.get(id);
    // A stopped lead cannot use its delegates' answers, so they stop with it.
    const children = await Promise.allSettled(
      this.deps.delegation.activeDelegates(id).map((child) => this.deps.interrupt(child.id)),
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
      this.deps.approvals.clear(id);
      delete session.approval;
      session.status = stopped ? 'interrupted' : 'failed';
      settleNative(session);
      this.deps.files.captureFiles(session, undefined, true);
      await this.deps.files.flush(id);
      for (const message of session.messages) {
        if (message.tool?.status === 'running') message.tool.status = 'interrupted';
      }
      this.deps.delegation.notifySettled(id);
      this.deps.changed();
    }
  }
  async disconnect(id: string): Promise<void> {
    this.deps.approvals.assertAvailable(id);
    const agent = this.agents.get(id);
    this.agents.delete(id);
    this.generations.delete(id);
    agent?.dispose();
    this.deps.approvals.clear(id);
    const session = this.deps.get(id);
    delete session.approval;
    session.status = 'interrupted';
    settleNative(session);
    this.deps.delegation.notifySettled(id);
    await this.deps.flush();
  }
  async dispose(): Promise<void> {
    for (const agent of this.agents.values()) agent.dispose();
    for (const session of this.deps.sessions) {
      if (session.status === 'running' || session.status === 'waiting')
        this.deps.files.captureFiles(session, undefined, true);
    }
    await this.deps.files.flushAll();
    this.deps.markDisposed();
    this.deps.files.forgetAll();
    for (const session of this.deps.sessions)
      if (session.status === 'running' || session.status === 'waiting') {
        session.status = 'interrupted';
        delete session.approval;
        settleNative(session);
      }
    this.deps.delegation.settleAll();
    this.agents.clear();
    this.generations.clear();
    this.deps.approvals.clearAll();
    await this.deps.flush();
  }
}
