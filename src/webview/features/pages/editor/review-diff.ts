import { type PageEdit, uniqueMatchOffset } from '../../../../shared/domain/pages/edits';

/** Reviewing an agent's suggested edits where they apply in the page. */

export type WordOp = { kind: 'same' | 'del' | 'ins'; text: string };

/**
 * A word-level difference between two short texts, whitespace kept with the word before it,
 * so joining the `same` and `del` parts gives `before` and the `same` and `ins` parts `after`.
 */
export function wordDiff(before: string, after: string): WordOp[] {
  const a = before.match(/\S+\s*|\s+/g) ?? [];
  const b = after.match(/\S+\s*|\s+/g) ?? [];
  const ops: WordOp[] = [];
  for (const op of diffUnits(a, b)) {
    const text = op.kind === 'ins' ? b[op.b] : a[op.a];
    const last = ops.at(-1);
    if (last?.kind === op.kind) last.text += text;
    else ops.push({ kind: op.kind, text });
  }
  return ops;
}

export type UnitOp =
  | { kind: 'same'; a: number; b: number }
  | { kind: 'del'; a: number }
  | { kind: 'ins'; b: number };

/** Lines up two lists, such as a list's items before and after an edit, removals first. */
export function alignUnits(a: readonly string[], b: readonly string[]): UnitOp[] {
  return [...diffUnits(a, b)];
}

function* diffUnits(a: readonly string[], b: readonly string[]): Generator<UnitOp> {
  // Longest common subsequence, used to choose which units stay in place.
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      yield { kind: 'same', a: i++, b: j++ };
    } else if (
      i < a.length &&
      (j === b.length || table[(i + 1) * cols + j] >= table[i * cols + j + 1])
    ) {
      yield { kind: 'del', a: i++ };
    } else {
      yield { kind: 'ins', b: j++ };
    }
  }
}

export type EditPlace =
  /** The edit replaces top-level blocks `first` to `last` of the page. */
  | { kind: 'blocks'; first: number; last: number; before: string; after: string }
  /** The edit adds to the end of the page. */
  | { kind: 'append'; after: string };

/**
 * Where an edit lands among the page's top-level blocks, given each block's span in `body`.
 * `before` and `after` are those blocks' Markdown without and with the edit, so the page can show
 * the change as whole blocks. Undefined when the edit doesn't fit.
 */
export function placeEdit(
  body: string,
  blocks: { start: number; end: number }[],
  edit: PageEdit,
): EditPlace | undefined {
  if (!edit.find) return { kind: 'append', after: edit.replace.trim() };
  const at = uniqueMatchOffset(body, edit.find);
  if (at === undefined) return undefined;
  const end = at + edit.find.length;
  let first = -1;
  let last = -1;
  blocks.forEach((block, index) => {
    if (block.end > at && block.start < end) {
      if (first < 0) first = index;
      last = index;
    }
  });
  // Only whitespace between blocks: show it after the block before.
  if (first < 0) {
    let previous = -1;
    blocks.forEach((block, index) => {
      if (block.end <= at) previous = index;
    });
    if (previous < 0) return undefined;
    first = previous;
    last = previous;
  }
  const from = Math.min(blocks[first].start, at);
  const to = Math.max(blocks[last].end, end);
  const before = body.slice(from, to);
  const after = body.slice(from, at) + edit.replace + body.slice(end, to);
  return { kind: 'blocks', first, last, before, after };
}
