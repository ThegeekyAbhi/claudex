const MIRRORED = [
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'tabSize',
  'textIndent',
  'textTransform',
  'wordSpacing',
] as const;
/** A textarea won't say where a character is, so a hidden copy with the same wrapping measures it. */
export function caretRect(textarea: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const name of MIRRORED) mirror.style[name] = style[name];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);
  const box = textarea.getBoundingClientRect();
  const top = box.top + marker.offsetTop - textarea.scrollTop;
  const left = box.left + marker.offsetLeft - textarea.scrollLeft;
  const height = marker.offsetHeight;
  mirror.remove();
  return { left, top, bottom: top + height };
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
