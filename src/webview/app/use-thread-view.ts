import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/model';
import { pruneSeen, type SeenAt } from '../features/threads/tab-state';
import type { ThreadViewState } from '../features/threads/thread-filter';
import type { ViewState } from './bridge';

export function useThreadView(
  saved: ViewState | undefined,
  sessions: Session[],
  session: Session | undefined,
) {
  const [threadView, setThreadView] = useState<ThreadViewState>(saved?.threadView ?? {});
  const [seen, setSeen] = useState<SeenAt>(saved?.seen ?? {});
  const [visible, setVisible] = useState(!document.hidden);
  const scroll = useRef<Record<string, number>>(saved?.scroll ?? {});
  const known = new Set(sessions.map((item) => item.id));
  const loaded = sessions.length > 0;
  const threadChildren = new Map<string, Session[]>();
  for (const item of sessions)
    if (item.parentId)
      threadChildren.set(item.parentId, [...(threadChildren.get(item.parentId) ?? []), item]);
  const seenId = session?.id;
  const seenAt = session?.updatedAt;
  const seenRunning = session?.status === 'running';
  // While a thread streams, its first look is enough: leaving it mid-turn must still count later.
  useEffect(() => {
    if (!seenId || seenAt === undefined || !visible) return;
    setSeen((current) =>
      seenRunning && current[seenId] !== undefined ? current : { ...current, [seenId]: seenAt },
    );
  }, [seenId, seenAt, seenRunning, visible]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only needed when threads come or go
  useEffect(() => {
    if (loaded) setSeen((current) => pruneSeen(current, known));
  }, [loaded, sessions.length]);
  useEffect(() => {
    const listener = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  return { threadView, setThreadView, seen, scroll, children: threadChildren };
}
