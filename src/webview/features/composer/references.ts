import { type Attachment, attachmentLabel, attachmentToken } from '../../../shared/model';

export type PathAttachment = Extract<Attachment, { kind: 'file' | 'folder' }>;
/** Attachments that sit in your text as chips, where you put them, rather than above it. */
export type InlineAttachment = Extract<Attachment, { kind: 'file' | 'folder' | 'page' | 'skill' }>;
export function isInline(item: Attachment): item is InlineAttachment {
  return (
    item.kind === 'file' || item.kind === 'folder' || item.kind === 'page' || item.kind === 'skill'
  );
}
function isPath(item: Attachment): item is PathAttachment {
  return item.kind === 'file' || item.kind === 'folder';
}
/** A chip's tooltip, which also finds its attachment again in rendered Markdown. */
export function inlineTitle(item: InlineAttachment): string {
  if (isPath(item)) return item.path;
  if (item.kind === 'page') return `Page · ${item.title ?? 'Page'}`;
  return `Skill · ${attachmentLabel(item)}`;
}
export interface ReferencePart {
  text: string;
  attachment?: InlineAttachment;
  label?: string;
}
export function referenceParts(text: string, attachments: Attachment[]): ReferencePart[] {
  const paths = attachments.filter(isPath);
  const tokens = new Map<string, InlineAttachment>();
  for (const item of attachments.filter(isInline)) tokens.set(attachmentToken(item), item);
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
    let attachment: InlineAttachment | undefined;
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
    let label = name;
    if (isPath(attachment)) {
      const { path } = attachment;
      if (paths.some((item) => item.path !== path && attachmentLabel(item) === name)) {
        label = path.split('/').slice(-2).join('/');
      }
    }
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
