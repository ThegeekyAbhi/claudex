import {
  agentTarget,
  type DelegateRequest,
  type DelegateResult,
  deriveTitle,
  type Provider,
  type Session,
  type SessionInput,
} from '../../shared/model';

interface Dependencies {
  sessions: Session[];
  get(id: string): Session;
  create(
    provider: Provider,
    cwd: string,
    workspace: string,
    title: string,
    parentId?: string,
    profileId?: string,
  ): Session;
  send(id: string, text: string, input?: SessionInput): Promise<void>;
}

export class SessionDelegation {
  private waiters = new Map<string, () => void>();
  constructor(private deps: Dependencies) {}
  /** Runs one agent as a child thread. It uses its own provider session and its own approvals. */
  async delegate(
    parentId: string,
    request: DelegateRequest,
    onStart?: (sessionId: string) => void,
    input?: SessionInput,
  ): Promise<DelegateResult> {
    const parent = this.deps.get(parentId);
    const target = agentTarget(request.agent);
    const child = this.deps.create(
      target.provider,
      parent.cwd,
      parent.workspace,
      deriveTitle(request.prompt),
      parent.id,
      target.profileId,
    );
    child.delegated = true;
    child.model = request.model;
    child.effort = request.effort;
    onStart?.(child.id);
    const finished = new Promise<void>((resolve) => this.waiters.set(child.id, resolve));
    await this.deps.send(child.id, request.prompt, input);
    await finished;
    return {
      sessionId: child.id,
      status: child.status,
      text: child.messages.filter((message) => message.role === 'assistant').at(-1)?.text ?? '',
    };
  }
  notifySettled(id: string): void {
    const resolve = this.waiters.get(id);
    if (!resolve) return;
    this.waiters.delete(id);
    resolve();
  }
  settleAll(): void {
    for (const id of [...this.waiters.keys()]) this.notifySettled(id);
  }
  activeDelegates(parentId: string): Session[] {
    return this.deps.sessions.filter(
      (item) =>
        item.parentId === parentId &&
        item.delegated &&
        (item.status === 'running' || item.status === 'waiting'),
    );
  }
}
