import type { Attachment } from '../../shared/model';
import { referenceParts } from '../features/composer/references';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName: string; hProperties: Record<string, unknown> };
}
/** Keep Markdown formatting while replacing only text backed by attachment metadata. */
export function remarkReferences({ attachments }: { attachments: Attachment[] }) {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children || node.type === 'code' || node.type === 'inlineCode') return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return [child];
        }
        return referenceParts(child.value, attachments).map((part): MarkdownNode => {
          if (!part.attachment) return { type: 'text', value: part.text };
          return {
            type: 'referenceChip',
            data: {
              hName: 'span',
              hProperties: { className: ['inline-reference'], title: part.attachment.path },
            },
            children: [{ type: 'text', value: part.label }],
          };
        });
      });
    }
    visit(tree);
  };
}
