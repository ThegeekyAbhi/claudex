export function editorText(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.editorEnd) return '';
  if (node instanceof HTMLElement && node.dataset.token) return node.dataset.token;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return '\n';
  return Array.from(node.childNodes, editorText).join('');
}
export function editorPoint(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  function find(parent: Node): { node: Node; offset: number } | undefined {
    for (const [index, child] of Array.from(parent.childNodes).entries()) {
      const length = editorText(child).length;
      if (child instanceof HTMLElement && child.dataset.token) {
        if (remaining <= length) return { node: parent, offset: index + (remaining > 0 ? 1 : 0) };
      } else if (child.nodeType === Node.TEXT_NODE && remaining <= length) {
        return { node: child, offset: remaining };
      } else if (remaining < length) {
        return find(child);
      }
      remaining -= length;
    }
    return undefined;
  }
  return find(root) ?? { node: root, offset: root.childNodes.length };
}
export function editorSelection(root: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (
    !selection?.rangeCount ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  )
    return { start: editorText(root).length, end: editorText(root).length };
  const selected = selection.getRangeAt(0);
  function offset(node: Node, index: number) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, index);
    return editorText(range.cloneContents()).length;
  }
  return {
    start: offset(selected.startContainer, selected.startOffset),
    end: offset(selected.endContainer, selected.endOffset),
  };
}
export function selectEditor(root: HTMLElement, start: number, end = start) {
  const from = editorPoint(root, start);
  const to = editorPoint(root, end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
export interface ComposerEditorHandle {
  element: HTMLDivElement | null;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}
