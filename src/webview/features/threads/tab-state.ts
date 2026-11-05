import type { ThreadChildren, ThreadNode } from './thread-filter';

export type SeenAt = Record<string, number>;
/** What a tab or row needs to say about a thread you may not be looking at. */
export type ThreadSignal = 'waiting' | 'running' | 'terminal' | 'failed' | 'unread' | undefined;
export const SIGNAL_LABELS: Record<NonNullable<ThreadSignal>, string> = {
  waiting: 'Needs your review',
  running: 'Running',
  terminal: 'In terminal',
  failed: 'Failed',
  unread: 'Finished since you last looked',
};
type SignalNode = ThreadNode & { updatedAt: number };
/** Only a thread you have opened can be unread, so old history doesn't all light up. */
export function isUnread(item: SignalNode, seen: SeenAt): boolean {
  const at = seen[item.id];
  return item.status === 'completed' && at !== undefined && item.updatedAt > at;
}
function hasWaiting<T extends ThreadNode>(item: T, children: ThreadChildren<T>): boolean {
  return (
    item.status === 'waiting' ||
    (children.get(item.id) ?? []).some((kid) => hasWaiting(kid, children))
  );
}
/** A subagent waiting on you counts for its parent, because that's where you would look. */
export function threadSignal<T extends SignalNode>(
  item: T,
  children: ThreadChildren<T>,
  seen: SeenAt,
): ThreadSignal {
  if (item.inTerminal) return 'terminal';
  if (hasWaiting(item, children)) return 'waiting';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'running') return 'running';
  return isUnread(item, seen) ? 'unread' : undefined;
}
/** A chat that hasn't started has a tab too. Its key doubles as the key of its draft. */
export const DRAFT_TAB = '__compose';
export function isDraftTab(key: string): boolean {
  return key === DRAFT_TAB || key.startsWith(`${DRAFT_TAB}:`);
}
/**
 * Keeps your order, adds the open tab, and drops threads that no longer exist. A chat that just
 * started takes over the tab of the draft it came from, so it doesn't jump along the row.
 */
export function reconcileTabs(
  tabs: string[],
  activeKey: string | undefined,
  known: Set<string>,
  replacing?: string,
): string[] {
  const kept = tabs.filter((key) => isDraftTab(key) || known.has(key));
  if (!activeKey || kept.includes(activeKey)) return kept;
  if (!isDraftTab(activeKey) && !known.has(activeKey)) return kept;
  return replacing && kept.includes(replacing)
    ? kept.map((key) => (key === replacing ? activeKey : key))
    : [...kept, activeKey];
}
/** What should rise above recency: waiting on you, or failed since you last looked. */
export function needsYou<T extends SignalNode>(
  item: T,
  children: ThreadChildren<T>,
  seen: SeenAt,
): boolean {
  if (hasWaiting(item, children)) return true;
  const at = seen[item.id];
  return item.status === 'failed' && at !== undefined && item.updatedAt > at;
}
/** The tab to show after closing one: its right neighbour, otherwise its left. */
export function tabAfterClosing(tabs: string[], id: string): string | undefined {
  const index = tabs.indexOf(id);
  const rest = tabs.filter((tab) => tab !== id);
  return rest[Math.min(index, rest.length - 1)];
}
export function pruneSeen(seen: SeenAt, known: Set<string>): SeenAt {
  return Object.fromEntries(Object.entries(seen).filter(([id]) => known.has(id)));
}
