import { editorPoint } from '../features/composer/editor-dom';

export function caretRect(editor: HTMLElement, index: number) {
  const point = editorPoint(editor, index);
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  if (rect.height) return rect;
  const box = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  const top = box.top + Number.parseFloat(style.paddingTop);
  const left = box.left + Number.parseFloat(style.paddingLeft);
  return { left, top, bottom: top + Number.parseFloat(style.lineHeight) };
}
export const MENU_MAX_HEIGHT = 320;
const GAP = 4;
const MARGIN = 8;
export interface MenuAnchor {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  /** Room to the right of the list, for the path preview beside it. */
  previewWidth: number;
}
/**
 * Under the caret when there's room, as in Cursor, and otherwise above its line. Coordinates are
 * relative to `frame`, which the menu is positioned inside.
 */
export function placeMenu(
  caret: { left: number; top: number; bottom: number },
  frame: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  listWidth: number,
): MenuAnchor {
  const below = viewport.height - caret.bottom - GAP - MARGIN;
  const above = caret.top - GAP - MARGIN;
  const opensBelow = below >= MENU_MAX_HEIGHT || below >= above;
  const rightmost = viewport.width - MARGIN - listWidth - frame.left;
  const left = Math.max(Math.min(caret.left - frame.left, rightmost), MARGIN - frame.left);
  return {
    left,
    ...(opensBelow
      ? { top: caret.bottom - frame.top + GAP }
      : { bottom: frame.bottom - caret.top + GAP }),
    maxHeight: Math.min(MENU_MAX_HEIGHT, opensBelow ? below : above),
    previewWidth: viewport.width - MARGIN - (frame.left + left + listWidth + 6),
  };
}
/** Styles for a menu's outer box. Its list reads its height limit from the variable. */
export function menuAnchorStyle(anchor: MenuAnchor): React.CSSProperties {
  return {
    left: anchor.left,
    top: anchor.top,
    bottom: anchor.bottom,
    '--menu-max-h': `${anchor.maxHeight}px`,
  } as React.CSSProperties;
}
