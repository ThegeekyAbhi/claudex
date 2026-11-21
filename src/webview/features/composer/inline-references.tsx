import type { ReactNode } from 'react';
import type { Attachment } from '../../../shared/model';
import { attachmentLabel } from '../../../shared/model';
import { InlineIcon } from '../../components/reference-icon';
import { inlineTitle, isInline, referenceParts } from './references';

interface Props {
  text: string;
  attachments: Attachment[];
}
export function InlineReferences({ text, attachments }: Props): ReactNode {
  const parts = referenceParts(text, attachments);
  const referenced = new Set(parts.map((part) => part.attachment));
  for (const item of attachments) {
    if (isInline(item) && !referenced.has(item)) {
      parts.push({ text: ' ' }, { text: '', attachment: item, label: attachmentLabel(item) });
    }
  }
  return parts.map((part, index) =>
    part.attachment ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's references never change
      <span key={index} className="inline-reference" title={inlineTitle(part.attachment)}>
        <InlineIcon attachment={part.attachment} />
        <span className="reference-label">{part.label}</span>
      </span>
    ) : (
      part.text
    ),
  );
}
