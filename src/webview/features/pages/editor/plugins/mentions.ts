import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { MentionState } from '../types';

/** An `@` at the start of a line or after a space opens the mention menu. */
export function mentionAt(view: EditorView): MentionState | undefined {
  const { selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return undefined;
  const $from = selection.$from;
  if ($from.parent.type.name === 'code_block') return undefined;
  if ($from.marks().some((mark) => mark.type.name === 'inlineCode' || mark.type.name === 'link'))
    return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!match) return undefined;
  const from = selection.from - match[1].length - 1;
  const coords = view.coordsAtPos(from);
  return {
    query: match[1],
    from,
    to: selection.from,
    left: coords.left,
    top: coords.bottom,
  };
}

/**
 * Puts a link where the `@query` was, then a plain space with the caret after it. Links are
 * inclusive, so inserting at the caret would extend the link, and stored marks would carry it
 * into whatever you type next.
 */
export function insertLink(
  view: EditorView,
  text: string,
  href: string,
  range?: { from: number; to: number },
): void {
  const type = view.state.schema.marks.link;
  if (!type || !text) return;
  const tr = range ? view.state.tr.delete(range.from, range.to) : view.state.tr;
  tr.replaceSelectionWith(view.state.schema.text(text, [type.create({ href })]), false);
  const end = tr.selection.from;
  tr.insert(end, view.state.schema.text(' '));
  tr.setSelection(TextSelection.create(tr.doc, end + 1));
  tr.setStoredMarks([]);
  view.dispatch(tr);
  view.focus();
}
