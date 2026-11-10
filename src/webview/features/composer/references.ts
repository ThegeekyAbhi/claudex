import { type Attachment, attachmentLabel, attachmentToken } from '../../../shared/model';

export type PathAttachment = Extract<Attachment, { kind: 'file' | 'folder' }>;
export interface ReferencePart {
  text: string;
  attachment?: PathAttachment;
  label?: string;
}
export function referenceParts(text: string, attachments: Attachment[]): ReferencePart[] {
  const paths = attachments.filter(
    (item): item is PathAttachment => item.kind === 'file' || item.kind === 'folder',
  );
  const tokens = new Map<string, PathAttachment>();
  for (const item of paths) tokens.set(attachmentToken(item), item);
  for (const item of paths) {
    const legacy = `[${attachmentLabel(item)}]`;
    if (
      !tokens.has(legacy) &&
      paths.filter((p) => attachmentLabel(p) === attachmentLabel(item)).length === 1
    )
      tokens.set(legacy, item);
  }
  const parts: ReferencePart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let start = text.length;
    let token = '';
    let attachment: PathAttachment | undefined;
    for (const [candidate, item] of tokens) {
      const found = text.indexOf(candidate, cursor);
      if (found >= 0 && (found < start || (found === start && candidate.length > token.length))) {
        start = found;
        token = candidate;
        attachment = item;
      }
    }
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    if (!attachment) break;
    const name = attachmentLabel(attachment);
    const duplicate = paths.some(
      (item) => item.path !== attachment.path && attachmentLabel(item) === name,
    );
    const label = duplicate ? attachment.path.split('/').slice(-2).join('/') : name;
    parts.push({ text: token, attachment, label });
    cursor = start + token.length;
  }
  return parts;
}
export function hasReference(text: string, item: Attachment, attachments: Attachment[]): boolean {
  return referenceParts(text, attachments).some((part) => part.attachment === item);
}

export function hasImageReference(text: string, item: Attachment): boolean {
  return item.kind === 'image' && Boolean(item.reference) && text.includes(attachmentToken(item));
}
