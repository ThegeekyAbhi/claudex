import type { Message, Session, Snapshot } from './session';

/** Enough recent messages that a reconciled final block is always inside the tail. */
const TAIL = 12;
function unfinished(message: Message): boolean {
  return message.tool?.status === 'running' || message.image?.status === 'generating';
}
/** Where the part of a transcript that can still change begins. */
export function tailStart(messages: Message[]): number {
  const open = messages.findIndex(unfinished);
  const recent = Math.max(0, messages.length - TAIL);
  return open < 0 ? recent : Math.min(open, recent);
}
/** A selected thread sends its transcript; its children send enough for inline cards. */
export function sessionsForView(sessions: Session[], selectedId?: string): Session[] {
  return sessions.map((session) => {
    if (session.id === selectedId) return session;
    if (session.parentId === selectedId)
      return { ...session, messages: session.messages.slice(-40) };
    const { plan: _plan, ...summary } = session;
    return { ...summary, messages: [] };
  });
}
export interface SnapshotUpdate
  extends Omit<Snapshot, 'catalog' | 'documents' | 'skills' | 'preferences'> {
  /** Left out when unchanged since the last update. */
  catalog?: Snapshot['catalog'];
  skills?: Snapshot['skills'];
  documents?: Snapshot['documents'];
  preferences?: Snapshot['preferences'];
}
/** Says that one thread's `messages` holds only its tail, from this index on. */
export interface TailMark {
  id: string;
  from: number;
}
/**
 * Applies an update. Earlier messages keep their object identity, so they don't re-render.
 * Returns undefined if this copy has too little to apply a tail to, and needs a full snapshot.
 */
export function mergeSnapshot(
  previous: Snapshot,
  update: SnapshotUpdate,
  tail?: TailMark,
): Snapshot | undefined {
  const known = tail && previous.sessions.find((session) => session.id === tail.id);
  if (tail && (!known || known.messages.length < tail.from)) return undefined;
  return {
    ...previous,
    ...update,
    catalog: update.catalog ?? previous.catalog,
    skills: update.skills ?? previous.skills,
    documents: update.documents ?? previous.documents,
    preferences: update.preferences ?? previous.preferences,
    sessions: update.sessions.map((session) =>
      tail && known && session.id === tail.id
        ? { ...session, messages: [...known.messages.slice(0, tail.from), ...session.messages] }
        : session,
    ),
  };
}
