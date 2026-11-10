import type { ReactNode } from 'react';
import type { Attachment } from '../../../shared/model';
import { ReferenceIcon } from '../../components/reference-icon';
import { referenceParts } from './references';

interface Props {
  text: string;
  attachments: Attachment[];
}
export function InlineReferences({ text, attachments }: Props): ReactNode {
  const parts = referenceParts(text, attachments);
  const referenced = new Set(parts.map((part) => part.attachment));
  for (const item of attachments) {
    if ((item.kind === 'file' || item.kind === 'folder') && !referenced.has(item)) {
      parts.push({ text: ' ' }, { text: '', attachment: item, label: item.path.split('/').pop() });
    }
  }
  return parts.map((part, index) =>
    part.attachment ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's references never change
      <span key={index} className="inline-reference" title={part.attachment.path}>
        <ReferenceIcon kind={part.attachment.kind} path={part.attachment.path} />
        <span className="reference-label">{part.label}</span>
      </span>
    ) : (
      part.text
    ),
  );
}
