import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { type EditorState, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { FILE_REFERENCE, filePart } from '../../../../../shared/domain/file-refs';
import { fileIconUrl } from '../../shared/file-icon';

export const chipKey = new PluginKey<DecorationSet>('page-file-chips');

/** The workspace path a text node names: a link's address, or inline code that looks like one. */
function pathRef(node: ProseNode): string | undefined {
  if (!node.isText) return undefined;
  const link = node.marks.find((mark) => mark.type.name === 'link');
  if (link) {
    const href = String(link.attrs.href ?? '');
    if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
    return FILE_REFERENCE.test(href) ? href : undefined;
  }
  if (!node.marks.some((mark) => mark.type.name === 'inlineCode')) return undefined;
  const text = (node.text ?? '').trim();
  return FILE_REFERENCE.test(text) ? text : undefined;
}
export function pathRefs(doc: ProseNode): string[] {
  const refs = new Set<string>();
  doc.descendants((node) => {
    const ref = pathRef(node);
    if (ref) refs.add(ref);
  });
  return [...refs];
}

/**
 * Workspace files read as chips: the file's icon and name, with its folder tucked away until the
 * cursor is in it, when the path shows as written so you can edit it.
 */
export function chipDecorations(state: EditorState, known: Map<string, boolean>): DecorationSet {
  const decorations: Decoration[] = [];
  const { from: selFrom, to: selTo } = state.selection;
  state.doc.descendants((node, pos) => {
    const ref = pathRef(node);
    if (!ref || known.get(ref) !== true) return;
    const end = pos + node.nodeSize;
    const isLink = node.marks.some((mark) => mark.type.name === 'link');
    if (!isLink && selFrom <= end && selTo >= pos) return;
    const name = filePart(ref).split('/').pop() ?? ref;
    const attrs = {
      class: 'page-file-chip',
      'data-file': ref,
      title: `${filePart(ref)}${ref.match(/:\d+(?:-\d+)?$/)?.[0] ?? ''} · click to open`,
      style: `--file-icon: url("${fileIconUrl(name)}")`,
    };
    const text = node.text ?? '';
    const folder = isLink ? 0 : text.replace(/:\d+(?:-\d+)?$/, '').lastIndexOf('/') + 1;
    if (folder > 0) {
      decorations.push(
        Decoration.inline(pos, pos + folder, { class: 'page-file-dir', 'data-file': ref }),
      );
    }
    decorations.push(Decoration.inline(pos + folder, end, attrs));
  });
  return DecorationSet.create(state.doc, decorations);
}

/** A plain click on a file chip opens the file; the cursor stays where it was. */
export function openChip(event: MouseEvent, open: (href: string) => void): boolean {
  if (event.button !== 0) return false;
  const chip = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-file]');
  const ref = chip?.dataset.file;
  if (!ref) return false;
  event.preventDefault();
  open(ref);
  return true;
}
