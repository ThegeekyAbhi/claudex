import { randomUUID } from 'node:crypto';
import {
  type AgentEvent,
  type Approval,
  applyTranscript,
  type Session,
  type SessionInput,
} from '../../shared/model';

type ApprovalRequest = Extract<AgentEvent, { type: 'approval' }>;
interface Dependencies {
  get(id: string): Session;
  changed(): void;
  approve(id: string, requestId: string, allowed: boolean, answers: Record<string, string>): void;
  stopTurn(id: string): Promise<void>;
  flush(): Promise<void>;
  send(id: string, text: string, input?: SessionInput): Promise<void>;
  isDisposed(): boolean;
}

export class SessionApprovals {
  private pending = new Map<string, Map<string, ApprovalRequest>>();
  private transitions = new Map<string, { cancelled: boolean }>();
  constructor(private deps: Dependencies) {}
  record(id: string, event: ApprovalRequest): void {
    const pending = this.pending.get(id) ?? new Map();
    pending.set(event.approval.id, event);
    this.pending.set(id, pending);
  }
  pendingFor(id: string): Approval | undefined {
    const pending = this.pending.get(id);
    return pending?.size ? pending.values().next().value?.approval : undefined;
  }
  clear(id: string): void {
    this.pending.delete(id);
  }
  clearAll(): void {
    this.pending.clear();
  }
  cancelTransition(id: string): boolean {
    const transition = this.transitions.get(id);
    if (!transition) return false;
    transition.cancelled = true;
    return true;
  }
  assertAvailable(id: string): void {
    if (this.transitions.has(id)) throw new Error('Wait for the Auto transition or stop it.');
  }
  approve(id: string, requestId: string, allowed: boolean, answers: Record<string, string>): void {
    this.assertAvailable(id);
    const session = this.deps.get(id);
    const pending = this.pending.get(id);
    const request = pending?.get(requestId);
    if (!pending || !request) throw new Error('This request is no longer pending.');
    pending.delete(requestId);
    const next = pending.values().next().value;
    session.approval = next?.approval;
    session.status = next ? 'waiting' : 'running';
    request.respond(allowed, answers);
    this.deps.changed();
  }
  /**
   * Your answer to one request, and a change of mode for what follows. Only an ordinary native
   * tool request qualifies: questions, plans, and requests to start another agent stay one-by-one.
   */
  allowInAuto(id: string, requestId: string): void {
    this.assertAvailable(id);
    const session = this.deps.get(id);
    const request = this.pending.get(id)?.get(requestId);
    if (!request) throw new Error('This request is no longer pending.');
    const { approval } = request;
    if (approval.origin !== 'provider' || approval.questions || approval.kind)
      throw new Error('This request has to be answered on its own.');
    if (session.observed) throw new Error('This worker is controlled by its main agent.');
    if (session.provider === 'codex' && session.nativeSettings?.approvalPolicy !== 'on-request')
      throw new Error('Native Auto requires an on-request approval policy.');
    session.mode = 'auto';
    delete session.reportedMode;
    this.deps.approve(id, requestId, true, {});
  }
  async resumeInAuto(id: string, requestId: string): Promise<void> {
    this.assertAvailable(id);
    const session = this.deps.get(id);
    const request = this.pending.get(id)?.get(requestId)?.approval;
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
    this.deps.changed();
    try {
      await this.deps.stopTurn(id);
      if (transition.cancelled || this.deps.isDisposed()) return;
      session.mode = 'auto';
      delete session.reportedMode;
      session.transition = 'resuming';
      this.deps.changed();
      await this.deps.flush();
      if (transition.cancelled || this.deps.isDisposed()) return;
      // Release only after persistence succeeds; send reserves the running session synchronously.
      this.transitions.delete(id);
      delete session.transition;
      await this.deps.send(
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
      this.deps.changed();
    }
  }
}
