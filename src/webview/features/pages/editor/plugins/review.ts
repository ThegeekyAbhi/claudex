import { DOMSerializer, Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { type EditorState, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { alignUnits, wordDiff } from '../review-diff';
import type { ReviewChange } from '../types';

export const reviewKey = new PluginKey<DecorationSet>('page-review');

/** Text positions of a block's characters, in `textContent` order. */
function textPositions(block: ProseNode, start: number): number[] {
  const positions: number[] = [];
  block.descendants((node, pos) => {
    if (!node.isText) return;
    for (let index = 0; index < (node.text?.length ?? 0); index++)
      positions.push(start + 1 + pos + index);
  });
  return positions;
}

function actions(
  change: ReviewChange,
  review: (key: string, accept: boolean) => void,
): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'page-change-actions';
  bar.contentEditable = 'false';
  const who = document.createElement('span');
  who.className = 'page-change-who';
  who.textContent = change.agent;
  const button = (label: string, accept: boolean) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.className = accept ? 'page-change-accept' : 'page-change-reject';
    element.setAttribute('aria-label', `${label} ${change.agent}’s change`);
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', () => review(change.key, accept));
    return element;
  };
  bar.append(who, button('Accept', true), button('Reject', false));
  return bar;
}

/**
 * Suggested changes, drawn where they apply: removed words struck through and added ones
 * highlighted inside a block, or whole blocks marked removed with their replacement drawn below.
 */
export function reviewDecorations(
  state: EditorState,
  changes: ReviewChange[],
  parse: (markdown: string) => ProseNode,
  review: (key: string, accept: boolean) => void,
  /** Where an image path in the page loads from, as the editor itself shows images. */
  imageUrl: (src: string) => string = (src) => src,
): DecorationSet {
  const { doc, schema } = state;
  const serializer = DOMSerializer.fromSchema(schema);
  const decorations: Decoration[] = [];
  const starts: number[] = [];
  let offset = 0;
  doc.forEach((child) => {
    starts.push(offset);
    offset += child.nodeSize;
  });
  const parsed = (markdown: string): ProseNode | undefined => {
    try {
      return parse(markdown);
    } catch {
      return undefined;
    }
  };
  const blockWidget = (change: ReviewChange, at: number, markdown: string) => {
    const content = markdown.trim() ? parsed(markdown) : undefined;
    decorations.push(
      Decoration.widget(
        at,
        () => {
          const box = document.createElement('div');
          box.className = 'page-change-ins';
          box.dataset.change = change.key;
          box.contentEditable = 'false';
          if (content) box.append(serializer.serializeFragment(content.content));
          resolveImages(box, imageUrl);
          box.append(actions(change, review));
          return box;
        },
        {
          side: 1,
          key: `${change.key}:${markdown.length}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    );
  };
  for (const change of changes) {
    const { place } = change;
    if (place.kind === 'append') {
      blockWidget(change, doc.content.size, place.after);
      continue;
    }
    if (place.last >= doc.childCount) continue;
    const first = doc.child(place.first);
    const end = starts[place.last] + doc.child(place.last).nodeSize;
    const next = place.first === place.last ? parsed(place.after) : undefined;
    const nextBlock = next?.childCount === 1 ? next.child(0) : undefined;
    // A change inside one paragraph or heading reads best word by word.
    if (nextBlock && nextBlock.type === first.type && first.isTextblock) {
      const words = wordLevel(first, starts[place.first], nextBlock.textContent, change.key);
      if (words) {
        decorations.push(
          Decoration.node(starts[place.first], end, {
            class: 'page-change page-change-inline',
            'data-change': change.key,
          }),
          ...words,
          Decoration.widget(end - 1, () => actions(change, review), {
            side: 1,
            key: `${change.key}:actions`,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        );
        continue;
      }
    }
    // In a list, only the items that change are marked.
    if (nextBlock && nextBlock.type === first.type && /list/.test(first.type.name)) {
      const items = listChanges(
        first,
        starts[place.first],
        nextBlock,
        change.key,
        serializer,
        imageUrl,
      );
      if (items) {
        decorations.push(
          ...items,
          Decoration.widget(
            end,
            () => {
              const row = document.createElement('div');
              row.className = 'page-change-actions-row';
              row.dataset.change = change.key;
              row.contentEditable = 'false';
              row.append(actions(change, review));
              return row;
            },
            { side: 1, key: `${change.key}:actions`, ignoreSelection: true, stopEvent: () => true },
          ),
        );
        continue;
      }
    }
    for (let index = place.first; index <= place.last; index++) {
      decorations.push(
        Decoration.node(starts[index], starts[index] + doc.child(index).nodeSize, {
          class: 'page-change page-change-gone',
          ...(index === place.first && !place.after.trim() ? { 'data-change': change.key } : {}),
        }),
      );
    }
    blockWidget(change, end, place.after);
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Word-level marks turning a textblock's text into `after`: removed words struck, added words
 * drawn in. Undefined when the two have too little in common to read that way.
 */
function wordLevel(
  block: ProseNode,
  blockPos: number,
  after: string,
  key: string,
): Decoration[] | undefined {
  const before = block.textContent;
  if (!before) return undefined;
  const ops = wordDiff(before, after);
  const same = ops.filter((op) => op.kind === 'same').reduce((n, op) => n + op.text.length, 0);
  if (!ops.some((op) => op.kind !== 'same') || same < before.length * 0.3) return undefined;
  const positions = textPositions(block, blockPos);
  const decorations: Decoration[] = [];
  let at = 0;
  ops.forEach((op, index) => {
    if (op.kind === 'ins') {
      const pos = at < positions.length ? positions[at] : (positions.at(-1) ?? blockPos) + 1;
      decorations.push(
        Decoration.widget(
          pos,
          () => {
            const span = document.createElement('span');
            span.className = 'page-change-added';
            span.textContent = op.text;
            return span;
          },
          { side: -1, key: `${key}:ins:${index}:${op.text}`, ignoreSelection: true },
        ),
      );
      return;
    }
    const start = at;
    at += op.text.length;
    if (op.kind !== 'del') return;
    // Character positions can jump across inline nodes; mark each run.
    let runStart = positions[start];
    for (let index2 = start + 1; index2 <= at; index2++) {
      const previous = positions[index2 - 1];
      if (index2 === at || positions[index2] !== previous + 1) {
        decorations.push(
          Decoration.inline(runStart, previous + 1, { class: 'page-change-removed' }),
        );
        runStart = positions[index2];
      }
    }
  });
  return decorations;
}

/** A list's items that a change removes, rewrites or adds, marked where they are. */
function listChanges(
  list: ProseNode,
  listPos: number,
  next: ProseNode,
  key: string,
  serializer: DOMSerializer,
  imageUrl: (src: string) => string,
): Decoration[] | undefined {
  const oldItems: ProseNode[] = [];
  const itemPos: number[] = [];
  let pos = listPos + 1;
  list.forEach((item) => {
    oldItems.push(item);
    itemPos.push(pos);
    pos += item.nodeSize;
  });
  const newItems: ProseNode[] = [];
  next.forEach((item) => {
    newItems.push(item);
  });
  const id = (item: ProseNode) => `${item.attrs.checked}|${item.textContent}`;
  const ops = alignUnits(oldItems.map(id), newItems.map(id));
  if (!ops.some((op) => op.kind !== 'same')) return undefined;
  const decorations: Decoration[] = [];
  const gone = (index: number) =>
    decorations.push(
      Decoration.node(itemPos[index], itemPos[index] + oldItems[index].nodeSize, {
        class: 'page-change-item page-change-gone',
      }),
    );
  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind === 'same') {
      index++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (index < ops.length && ops[index].kind !== 'same') {
      const op = ops[index++];
      if (op.kind === 'del') removed.push(op.a);
      else added.push(op.b);
    }
    // A rewritten item pairs with the one it replaces, and shows word by word.
    const unadded: number[] = [];
    added.forEach((b, at) => {
      const a = removed[at];
      const oldItem = a === undefined ? undefined : oldItems[a];
      const newItem = newItems[b];
      const words =
        oldItem?.childCount === 1 && oldItem.firstChild?.isTextblock && newItem.childCount === 1
          ? wordLevel(oldItem.firstChild, itemPos[a] + 1, newItem.textContent, `${key}:${b}`)
          : undefined;
      if (oldItem && words && oldItem.attrs.checked === newItem.attrs.checked) {
        decorations.push(
          Decoration.node(itemPos[a], itemPos[a] + oldItem.nodeSize, { class: 'page-change-item' }),
          ...words,
        );
        removed[at] = -1;
      } else unadded.push(b);
    });
    for (const a of removed) if (a >= 0) gone(a);
    if (!unadded.length) continue;
    // New items go after the last item before them.
    const lastOld = removed.filter((a) => a >= 0).at(-1);
    const previousSame = ops
      .slice(0, index)
      .filter((op) => op.kind !== 'ins')
      .at(-1);
    const after = lastOld ?? (previousSame && 'a' in previousSame ? previousSame.a : undefined);
    const anchor = after === undefined ? listPos + 1 : itemPos[after] + oldItems[after].nodeSize;
    const fragment = next.copy(Fragment.from(unadded.map((b) => newItems[b])));
    decorations.push(
      Decoration.widget(
        anchor,
        () => {
          const box = document.createElement('div');
          box.className = 'page-change-ins page-change-ins-items';
          box.contentEditable = 'false';
          box.append(serializer.serializeNode(fragment));
          resolveImages(box, imageUrl);
          return box;
        },
        {
          side: 1,
          key: `${key}:items:${unadded.join(',')}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    );
  }
  return decorations;
}

/**
 * A suggestion's preview is drawn straight from the schema, which writes an image's path as it
 * is in the Markdown. Pages' images load from their own folder, so resolve them as the editor does.
 */
function resolveImages(box: HTMLElement, imageUrl: (src: string) => string): void {
  for (const image of Array.from(box.querySelectorAll('img'))) {
    const src = image.getAttribute('src');
    if (src) image.setAttribute('src', imageUrl(src));
  }
}
