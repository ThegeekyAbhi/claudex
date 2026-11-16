import { useEffect, useState } from 'react';
import type { Session } from '../../../shared/model';
import { type HostMessage, send } from '../../app/bridge';

export interface SideAnswer {
  requestId: string;
  question: string;
  answer: string;
  status: 'answering' | 'done' | 'failed' | 'stopped';
  error?: string;
  /** What the agent looked at while answering, such as files Codex read. */
  activity?: string[];
}
type Earlier = { question: string; answer: string }[];
/** Follow-ups see this many earlier side questions, like Claude Code's own `/btw`. */
const KEEP = 20;

/** `/btw text`, or undefined if the message isn't a side question. */
export function sideQuestionText(draft: string): string | undefined {
  const match = /^\/btw(?:\s+([\s\S]*))?$/.exec(draft.trim());
  return match ? (match[1] ?? '').trim() : undefined;
}

/**
 * Side questions per thread, held only in this view: they are never saved or sent to the thread,
 * so closing the panel or reloading the window forgets them.
 */
export function useSideQuestions() {
  const [byThread, setByThread] = useState<Record<string, SideAnswer[]>>({});
  const [open, setOpen] = useState<string | undefined>();
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type !== 'sideAnswer') return;
      setByThread((current) => {
        const next: Record<string, SideAnswer[]> = {};
        for (const [id, items] of Object.entries(current))
          next[id] = items.map((item) => {
            if (item.requestId !== message.requestId) return item;
            const answer = item.answer + (message.delta ?? '');
            const activity = message.activity
              ? [...(item.activity ?? []), message.activity]
              : item.activity;
            if (!message.done) return { ...item, answer, ...(activity ? { activity } : {}) };
            if (message.error) return { ...item, answer, status: 'failed', error: message.error };
            return { ...item, answer, status: item.status === 'stopped' ? 'stopped' : 'done' };
          });
        return next;
      });
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  /** Answered side questions before `until`, for a follow-up to read in context. */
  function earlierOf(sessionId: string, until?: string) {
    const items = byThread[sessionId] ?? [];
    const end = until ? items.findIndex((item) => item.requestId === until) : -1;
    return (end >= 0 ? items.slice(0, end) : items)
      .filter((item) => item.status === 'done' && item.answer)
      .slice(-5)
      .map((item) => ({ question: item.question, answer: item.answer }));
  }
  function request(session: Session, requestId: string, question: string, earlier: Earlier) {
    send({
      type: 'sideQuestion',
      id: session.id,
      requestId,
      text: question,
      ...(earlier.length ? { earlier } : {}),
    });
  }
  function ask(session: Session, question: string) {
    const requestId = crypto.randomUUID();
    const earlier = earlierOf(session.id);
    setByThread((current) => ({
      ...current,
      [session.id]: [
        ...(current[session.id] ?? []).slice(-(KEEP - 1)),
        { requestId, question, answer: '', status: 'answering' },
      ],
    }));
    setOpen(session.id);
    request(session, requestId, question, earlier);
  }
  /** Asks a failed or stopped side question again, in its place and with the same context. */
  function retry(session: Session, previous: string) {
    const item = (byThread[session.id] ?? []).find((entry) => entry.requestId === previous);
    if (!item || item.status === 'answering') return;
    const requestId = crypto.randomUUID();
    const earlier = earlierOf(session.id, previous);
    setByThread((current) => ({
      ...current,
      [session.id]: (current[session.id] ?? []).map((entry) =>
        entry.requestId === previous
          ? { requestId, question: entry.question, answer: '', status: 'answering' }
          : entry,
      ),
    }));
    request(session, requestId, item.question, earlier);
  }
  function stop(requestId: string) {
    send({ type: 'stopSideQuestion', requestId });
    setByThread((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, items]) => [
          id,
          items.map((item) =>
            item.requestId === requestId && item.status === 'answering'
              ? { ...item, status: 'stopped' as const }
              : item,
          ),
        ]),
      ),
    );
  }
  function clear(sessionId: string) {
    for (const item of byThread[sessionId] ?? [])
      if (item.status === 'answering')
        send({ type: 'stopSideQuestion', requestId: item.requestId });
    setByThread((current) => ({ ...current, [sessionId]: [] }));
    setOpen(undefined);
  }
  return {
    items: (sessionId?: string) => (sessionId ? (byThread[sessionId] ?? []) : []),
    isOpen: (sessionId?: string) => Boolean(sessionId && open === sessionId),
    setOpen: (sessionId: string | undefined) => setOpen(sessionId),
    ask,
    retry,
    stop,
    clear,
  };
}
