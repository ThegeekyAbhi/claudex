import { type Dispatch, type SetStateAction, useState } from 'react';
import { type Attachment, MAX_ATTACHMENTS, numberImages, parseMention } from '../../shared/model';
import type { ViewState } from './bridge';

export function useDrafts(saved: ViewState | undefined, onError: (message: string) => void) {
  const [texts, setTexts] = useState<Record<string, string>>(saved?.drafts ?? {});
  const [attachments, updateAttachments] = useState<Record<string, Attachment[]>>(() =>
    Object.fromEntries(
      Object.entries(saved?.attachments ?? {}).map(([key, items]) => [key, numberImages(items)]),
    ),
  );
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
  function sent(id: string, text: string) {
    const delivered = (draft = '') =>
      draft.trim() === text.trim() || parseMention(draft)?.prompt === text;
    setTexts((current) => (delivered(current[id]) ? { ...current, [id]: '' } : current));
    setAttachments((current) => ({ ...current, [id]: [] }));
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
  return { texts, setTexts, attachments, setAttachments, sent, write, attach };
}
