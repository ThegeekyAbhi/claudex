import type { Session } from '../../../core/model';

export type ThreadNode = Pick<Session, 'id' | 'parentId' | 'status' | 'inTerminal'>;
export type ThreadChildren<T extends ThreadNode> = Map<string, T[]>;
export interface ThreadViewState {
  runningOnly?: boolean;
  /** Parents whose earlier subagents are showing. */
  showEarlier?: Record<string, boolean>;
  collapsed?: Record<string, boolean>;
}
export function isActive(item: ThreadNode): boolean {
  return item.status === 'running' || item.status === 'waiting' || Boolean(item.inTerminal);
}
/** Failed and interrupted work was never finished, so it stays where you can see it. */
export function needsAttention(item: ThreadNode): boolean {
  return item.status === 'failed' || item.status === 'interrupted';
}
function subtreeHas<T extends ThreadNode>(
  item: T,
  children: ThreadChildren<T>,
  test: (node: ThreadNode) => boolean,
): boolean {
  return test(item) || (children.get(item.id) ?? []).some((kid) => subtreeHas(kid, children, test));
}
export function subtreeActive<T extends ThreadNode>(item: T, children: ThreadChildren<T>): boolean {
  return subtreeHas(item, children, isActive);
}
/** The open thread and the parents above it, which must stay visible when it finishes. */
export function selectedPath<T extends ThreadNode>(all: T[], selectedId?: string): Set<string> {
  const path = new Set<string>();
  const byId = new Map(all.map((item) => [item.id, item]));
  let current = selectedId ? byId.get(selectedId) : undefined;
  while (current && !path.has(current.id)) {
    path.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
/** With "Running only", the top-level threads that still have work going on. */
export function rootVisible<T extends ThreadNode>(
  item: T,
  children: ThreadChildren<T>,
  path: Set<string>,
): boolean {
  return path.has(item.id) || subtreeActive(item, children);
}
/** Splits a parent's subagents into those always shown and those behind "N earlier". */
export function splitChildren<T extends ThreadNode>(
  kids: T[],
  children: ThreadChildren<T>,
  path: Set<string>,
): { current: T[]; earlier: T[] } {
  const current: T[] = [];
  const earlier: T[] = [];
  for (const kid of kids) {
    const keep =
      path.has(kid.id) ||
      subtreeHas(kid, children, (node) => isActive(node) || needsAttention(node));
    (keep ? current : earlier).push(kid);
  }
  return { current, earlier };
}
