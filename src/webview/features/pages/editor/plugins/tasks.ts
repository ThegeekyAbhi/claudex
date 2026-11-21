import { InputRule } from '@milkdown/kit/prose/inputrules';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

/**
 * `[] ` or `[ ] ` at the start of a line makes it a to-do, and `[x] ` a done one, as in Notion.
 * In a list item it only marks the item; on a plain line it starts a list.
 */
export const taskRule = new InputRule(/^\s*\[( |x|X)?\]\s$/, (state, match, start, end) => {
  const $start = state.doc.resolve(start);
  const checked = (match[1] ?? ' ').toLowerCase() === 'x';
  const { list_item: item, bullet_list: list, paragraph } = state.schema.nodes;
  if (!item || !list || !paragraph || $start.parent.type !== paragraph) return null;
  const tr = state.tr.delete(start, end);
  for (let depth = $start.depth - 1; depth > 0; depth--) {
    const node = $start.node(depth);
    if (node.type === item) {
      return tr.setNodeMarkup($start.before(depth), undefined, { ...node.attrs, checked });
    }
  }
  const range = tr.doc.resolve(tr.mapping.map(start)).blockRange();
  if (!range) return null;
  tr.wrap(range, [
    { type: list, attrs: {} },
    { type: item, attrs: { checked } },
  ]);
  // Keep typing inside the new to-do, even before its checkbox has drawn.
  return tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(end))));
});

/** ⌘/Ctrl+Enter ticks or unticks the to-do at the cursor. */
export function toggleTaskAt(
  state: EditorView['state'],
  dispatch?: EditorView['dispatch'],
): boolean {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'list_item' && node.attrs.checked != null) {
      dispatch?.(
        state.tr.setNodeMarkup($from.before(depth), undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        }),
      );
      return true;
    }
  }
  return false;
}
