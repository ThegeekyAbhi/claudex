import { useState } from 'react';
import { type Attachment, parseMention } from '../../shared/model';
import type { ViewState } from './bridge';

export function useDrafts(saved: ViewState | undefined) {
  const [texts, setTexts] = useState<Record<string, string>>(saved?.drafts ?? {});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>(
    saved?.attachments ?? {},
  );
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
    setAttachments((current) => ({ ...current, [key]: [...(current[key] ?? []), attachment] }));
  }
  return { texts, setTexts, attachments, setAttachments, sent, write, attach };
}
