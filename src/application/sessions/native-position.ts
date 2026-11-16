import { agentKind, agentLabel, type Message, type Session } from '../../shared/model';

export type NativeOwner = NonNullable<Message['nativeOwner']>;

/** The agent running a thread now, in the form saved on its messages. */
export function currentOwner(session: Pick<Session, 'provider' | 'profileId'>): NativeOwner {
  return {
    provider: session.provider,
    ...(session.profileId ? { profileId: session.profileId } : {}),
  };
}

function sameOwner(a: NativeOwner, b: NativeOwner): boolean {
  return a.provider === b.provider && agentKind(a) === agentKind(b);
}

/** True once a thread has continued with another agent, from any earlier one. */
function switchedAgents(session: Session): boolean {
  const now = currentOwner(session);
  return (session.previousAgents ?? []).some((item) => !sameOwner(item, now));
}

/**
 * Whose CLI a message's native ids belong to. A message saved before owners were recorded is
 * trusted only in a thread that never changed agents; otherwise it belongs to nobody, so its ids
 * are never used.
 */
function ownerOf(session: Session, message: Message): NativeOwner | undefined {
  if (message.nativeOwner) return message.nativeOwner;
  return switchedAgents(session) ? undefined : currentOwner(session);
}

/** A native position the thread's current agent can resume or branch from. */
export interface NativePosition {
  nativeId: string;
  at: string;
}

export class ForeignTurnError extends Error {}

function label(owner: NativeOwner | undefined): string {
  return owner ? agentLabel(owner) : 'an earlier agent';
}

/**
 * Where one turn ended in the current agent's CLI transcript. Live turns record it on your
 * message; a turn read back from Claude's history carries the entry's uuid in each row's
 * `nativeRef` instead. Codex rows read from history carry item ids, which a fork can't use.
 * Throws `ForeignTurnError` when the turn ran with another agent, whose ids this one can't use.
 */
export function turnEnd(
  session: Session,
  messages: Message[],
  userIndex: number,
): NativePosition | undefined {
  const own = messages[userIndex];
  const now = currentOwner(session);
  const usable = (message: Message) => {
    const owner = ownerOf(session, message);
    return owner !== undefined && sameOwner(owner, now);
  };
  if (own?.nativeTurn) {
    if (!usable(own))
      throw new ForeignTurnError(
        `This turn ran with ${label(ownerOf(session, own))}, and this thread now continues with ${label(now)}, which can’t resume it.`,
      );
    const nativeId = own.nativeSession ?? session.nativeId;
    if (nativeId) return { nativeId, at: own.nativeTurn };
  }
  if (session.provider !== 'claude' || !session.nativeId) return undefined;
  let end = userIndex + 1;
  while (end < messages.length && messages[end].role !== 'user') end += 1;
  let foreign: Message | undefined;
  for (let index = end - 1; index >= userIndex; index--) {
    const ref = messages[index].nativeRef?.split(':')[0];
    if (!ref) continue;
    if (usable(messages[index])) return { nativeId: session.nativeId, at: ref };
    foreign ??= messages[index];
  }
  if (foreign)
    throw new ForeignTurnError(
      `This turn ran with ${label(ownerOf(session, foreign))}, and this thread now continues with ${label(now)}, which can’t resume it.`,
    );
  return undefined;
}

/**
 * Before a thread continues with another agent: records which agent its turns belong to, so
 * their ids stay with that agent.
 */
export function stampOwners(session: Session): void {
  const owner = currentOwner(session);
  const switched = switchedAgents(session);
  for (const message of session.messages)
    if ((message.nativeTurn || message.nativeRef) && !message.nativeOwner && !switched)
      message.nativeOwner = owner;
}
