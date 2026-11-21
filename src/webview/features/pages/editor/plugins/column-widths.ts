import type { Node } from '@milkdown/kit/prose/model';
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';

/**
 * Column widths you drag on a page's tables. Markdown tables have no widths, and pages stay
 * plain Markdown, so the widths live only in this view (the host keeps them per file on this
 * machine) and reach the page as decorations on the header cells; the document never changes.
 *
 * Tables render with `table-layout: fixed`, so the header row's widths set every column.
 */

/** Per table, in document order: each column's width in pixels, 0 for automatic. */
export type ColumnWidths = (number[] | null)[];

export const MIN_COLUMN = 72;
const EDGE = 5;

export const columnWidthsKey = new PluginKey<ColumnWidths>('page-column-widths');

type WidthChange =
  | { kind: 'set'; table: number; column: number; width: number; columns: number }
  | { kind: 'load'; widths: ColumnWidths };

/** The widths with one column changed; other tables and columns are kept. */
export function withColumnWidth(
  widths: ColumnWidths,
  table: number,
  column: number,
  width: number,
  columns: number,
): ColumnWidths {
  const next = widths.slice();
  while (next.length <= table) next.push(null);
  const current = next[table];
  const row =
    current && current.length === columns ? current.slice() : new Array<number>(columns).fill(0);
  row[column] = width > 0 ? Math.max(MIN_COLUMN, Math.round(width)) : 0;
  next[table] = row.some(Boolean) ? row : null;
  while (next.length && next[next.length - 1] === null) next.pop();
  return next;
}

/** The tables in document order and their first rows. */
function tables(doc: Node) {
  const found: { table: Node; pos: number; header: Node }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    const header = node.firstChild;
    if (header) found.push({ table: node, pos, header });
    return false;
  });
  return found;
}

/** Saved widths go on the header. Reserve room for automatic columns before CSS divides the rest. */
export function widthDecorations(state: EditorState, widths: ColumnWidths): DecorationSet {
  const decorations: Decoration[] = [];
  tables(state.doc).forEach(({ table, pos, header }, index) => {
    const saved = widths[index];
    const row = saved?.length === header.childCount ? saved : undefined;
    let minWidth = 0;
    let cellPos = pos + 2;
    header.forEach((cell, _offset, column) => {
      const width = row?.[column];
      const columnWidth = Math.max(MIN_COLUMN, width ?? 0);
      minWidth += columnWidth;
      if (width) {
        decorations.push(
          Decoration.node(cellPos, cellPos + cell.nodeSize, { style: `width: ${columnWidth}px` }),
        );
      }
      cellPos += cell.nodeSize;
    });
    decorations.push(
      Decoration.node(pos, pos + table.nodeSize, {
        style: `--page-table-min-width: ${minWidth}px`,
      }),
    );
  });
  return DecorationSet.create(state.doc, decorations);
}

/** The cell under the pointer when it is at that cell's right edge, ready to resize. */
function edgeAt(view: EditorView, event: MouseEvent) {
  const cell = (event.target as Element | null)?.closest?.('th, td');
  if (!(cell instanceof HTMLTableCellElement) || !view.dom.contains(cell)) return undefined;
  const rect = cell.getBoundingClientRect();
  if (Math.abs(event.clientX - rect.right) > EDGE) return undefined;
  const block = cell.closest<HTMLElement>('.milkdown-table-block');
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!block || !row) return undefined;
  const table = Array.from(view.dom.querySelectorAll('.milkdown-table-block')).indexOf(block);
  if (table < 0) return undefined;
  const header = cell.closest('table')?.rows[0]?.cells[cell.cellIndex];
  return {
    block,
    table,
    column: cell.cellIndex,
    columns: row.cells.length,
    width: (header ?? cell).getBoundingClientRect().width,
  };
}

/**
 * Drag a column's right edge to size it; double-click the edge to make it automatic again.
 * `saved` is told the widths after each change, to keep them for next time.
 */
export function columnWidthsPlugin(initial: ColumnWidths, saved: (widths: ColumnWidths) => void) {
  return new Plugin<ColumnWidths>({
    key: columnWidthsKey,
    state: {
      init: () => initial,
      apply: (tr, widths) => {
        const change = tr.getMeta(columnWidthsKey) as WidthChange | undefined;
        if (!change) return widths;
        if (change.kind === 'load') return change.widths;
        return withColumnWidth(widths, change.table, change.column, change.width, change.columns);
      },
    },
    props: {
      decorations: (state) => widthDecorations(state, columnWidthsKey.getState(state) ?? []),
    },
    view(view) {
      const set = (table: number, column: number, width: number, columns: number) =>
        view.dispatch(
          view.state.tr
            .setMeta(columnWidthsKey, { kind: 'set', table, column, width, columns })
            .setMeta('addToHistory', false),
        );
      // Classes and the guide stay outside the editor's DOM, which ProseMirror owns: a table
      // whose DOM changed under it would be redrawn. The cursor is set on the body instead.
      let hovered = false;
      let drag:
        | {
            edge: NonNullable<ReturnType<typeof edgeAt>>;
            startX: number;
            guide: HTMLElement;
          }
        | undefined;
      const hover = (near: boolean) => {
        if (hovered === near) return;
        hovered = near;
        document.body.classList.toggle('near-column-edge', near);
      };
      const onMove = (event: MouseEvent) => {
        if (drag) {
          const width = Math.max(MIN_COLUMN, drag.edge.width + event.clientX - drag.startX);
          set(drag.edge.table, drag.edge.column, width, drag.edge.columns);
          drag.guide.style.left = `${event.clientX}px`;
          return;
        }
        hover(Boolean(edgeAt(view, event)));
      };
      const onUp = () => {
        if (!drag) return;
        drag.guide.remove();
        document.body.classList.remove('resizing-column');
        drag = undefined;
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        saved(columnWidthsKey.getState(view.state) ?? []);
      };
      const onDown = (event: MouseEvent) => {
        if (event.button !== 0 || event.detail > 1) return;
        const edge = edgeAt(view, event);
        if (!edge) return;
        // The edge is ours: no text selection, no cell drag handle.
        event.preventDefault();
        event.stopPropagation();
        const guide = document.createElement('div');
        guide.className = 'column-resize-guide';
        const rect = edge.block.getBoundingClientRect();
        guide.style.top = `${rect.top}px`;
        guide.style.height = `${rect.height}px`;
        document.body.append(guide);
        document.body.classList.add('resizing-column');
        drag = { edge, startX: event.clientX, guide };
        onMove(event);
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
      };
      const onDouble = (event: MouseEvent) => {
        const edge = edgeAt(view, event);
        if (!edge) return;
        event.preventDefault();
        event.stopPropagation();
        set(edge.table, edge.column, 0, edge.columns);
        saved(columnWidthsKey.getState(view.state) ?? []);
      };
      const onLeave = () => {
        if (!drag) hover(false);
      };
      view.dom.addEventListener('mousemove', onMove);
      view.dom.addEventListener('mousedown', onDown, true);
      view.dom.addEventListener('dblclick', onDouble, true);
      view.dom.addEventListener('mouseleave', onLeave);
      return {
        destroy() {
          onUp();
          hover(false);
          view.dom.removeEventListener('mousemove', onMove);
          view.dom.removeEventListener('mousedown', onDown, true);
          view.dom.removeEventListener('dblclick', onDouble, true);
          view.dom.removeEventListener('mouseleave', onLeave);
        },
      };
    },
  });
}

/** Widths from the host, after the editor started (another tab of the same file changed them). */
export function loadColumnWidths(view: EditorView, widths: ColumnWidths): void {
  view.dispatch(
    view.state.tr.setMeta(columnWidthsKey, { kind: 'load', widths }).setMeta('addToHistory', false),
  );
}
