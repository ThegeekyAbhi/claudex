import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { SelectionState } from '../types';
import { blockKind } from './blocks';

/** What the selection bar needs to know about the selected text. */
export function selectionAt(view: EditorView): SelectionState | undefined {
  const { selection, schema } = view.state;
  if (selection.empty || !(selection instanceof TextSelection) || !view.hasFocus())
    return undefined;
  const text = view.state.doc.textBetween(selection.from, selection.to, '\n');
  if (!text.trim()) return undefined;
  const start = view.coordsAtPos(selection.from);
  const end = view.coordsAtPos(selection.to);
  const has = (name: string) => {
    const type = schema.marks[name];
    return Boolean(type && view.state.doc.rangeHasMark(selection.from, selection.to, type));
  };
  return {
    text,
    left: (start.left + end.left) / 2,
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
    block: blockKind(view.state),
    href: (() => {
      const link = schema.marks.link;
      if (!link) return undefined;
      let found: string | undefined;
      view.state.doc.nodesBetween(selection.from, selection.to, (node) => {
        const mark = link.isInSet(node.marks);
        if (mark && !found) found = String(mark.attrs.href ?? '');
      });
      return found;
    })(),
    active: {
      bold: has('strong'),
      italic: has('emphasis'),
      strike: has('strike_through'),
      code: has('inlineCode'),
    },
  };
}
