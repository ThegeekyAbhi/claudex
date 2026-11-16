import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from 'react';
import { type Attachment, MAX_ATTACHMENTS, numberImages } from '../../shared/model';
import type { ViewState } from './bridge';

export function useDrafts(saved: ViewState | undefined, onError: (message: string) => void) {
  const [textRevisions, updateTexts] = useState<Record<string, { text: string; revision: number }>>(
    () =>
      Object.fromEntries(
        Object.entries(saved?.drafts ?? {}).map(([key, text]) => [key, { text, revision: 0 }]),
      ),
  );
  const texts = useMemo(
    () =>
      Object.fromEntries(Object.entries(textRevisions).map(([key, value]) => [key, value.text])),
    [textRevisions],
  );
  const [attachments, updateAttachments] = useState<Record<string, Attachment[]>>(() =>
    Object.fromEntries(
      Object.entries(saved?.attachments ?? {}).map(([key, items]) => [key, numberImages(items)]),
    ),
  );
  const pending = useRef(
    new Map<string, { key: string; revision: number; attachments: Attachment[] }>(),
  );
  const setTexts: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    updateTexts((current) => {
      const values = Object.fromEntries(
        Object.entries(current).map(([key, value]) => [key, value.text]),
      );
      const next = typeof update === 'function' ? update(values) : update;
      return Object.fromEntries(
        Object.entries(next).map(([key, text]) => [
          key,
          {
            text,
            revision: (current[key]?.revision ?? 0) + (current[key]?.text === text ? 0 : 1),
          },
        ]),
      );
    });
  };
  function submitted(key: string): string {
    const id = crypto.randomUUID();
    pending.current.set(id, {
      key,
      revision: textRevisions[key]?.revision ?? 0,
      attachments: attachments[key] ?? [],
    });
    return id;
  }
  function failed(submissionId: string) {
    pending.current.delete(submissionId);
  }
  const setAttachments: Dispatch<SetStateAction<Record<string, Attachment[]>>> = (update) => {
    updateAttachments((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      return Object.fromEntries(
        Object.entries(next).map(([key, items]) => {
          if (items.length > MAX_ATTACHMENTS)
            queueMicrotask(() =>
              onError(
                `You can attach up to ${MAX_ATTACHMENTS} items per message. Extra attachments were not added.`,
              ),
            );
          return [key, numberImages(items.slice(0, MAX_ATTACHMENTS))];
        }),
      );
    });
  };
  function sent(id: string, _text: string, submissionId?: string, threadId = id) {
    // Older host fixtures may omit identity; only a single matching in-flight submission is safe.
    const matches = [...pending.current].filter(([, value]) => value.key === id);
    const identity = submissionId ?? (matches.length === 1 ? matches[0]?.[0] : undefined);
    const submission = identity ? pending.current.get(identity) : undefined;
    if (!identity || !submission || submission.key !== id) return;
    pending.current.delete(identity);
    updateTexts((current) => {
      const remaining =
        current[id]?.revision === submission.revision ? '' : (current[id]?.text ?? '');
      if (threadId === id)
        return {
          ...current,
          [id]: { text: remaining, revision: (current[id]?.revision ?? 0) + 1 },
        };
      const text = [current[threadId]?.text, remaining].filter(Boolean).join('\n\n');
      return {
        ...current,
        [id]: { text: '', revision: (current[id]?.revision ?? 0) + 1 },
        [threadId]: { text, revision: (current[threadId]?.revision ?? 0) + 1 },
      };
    });
    const delivered = new Set(submission.attachments);
    setAttachments((current) => {
      const remaining = (current[id] ?? []).filter((item) => !delivered.has(item));
      if (threadId === id) return { ...current, [id]: remaining };
      return { ...current, [id]: [], [threadId]: [...(current[threadId] ?? []), ...remaining] };
    });
  }
  function write(id: string, text: string) {
    setTexts((current) => ({ ...current, [id]: text }));
  }
  function attach(key: string, attachment: Attachment) {
    setAttachments((current) => ({
      ...current,
      [key]: [...(current[key] ?? []), attachment],
    }));
  }
  return { texts, setTexts, attachments, setAttachments, submitted, failed, sent, write, attach };
}
