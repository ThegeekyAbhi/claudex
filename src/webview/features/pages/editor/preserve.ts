/**
 * Keeps your Markdown as you wrote it. The editor writes Markdown in its own style (`*` or `-`
 * bullets, escaped characters), so saving its output whole would rewrite every line you never
 * touched. Instead, each top-level block the editor did not change keeps its original text,
 * and only the blocks you edited take the editor's form.
 */

/** Top-level block ranges of a Markdown text, as a Markdown parser reports them. */
export type BlockRanges = (markdown: string) => { start: number; end: number }[];

interface Block {
  text: string;
  /** What came between this block and the one before it. */
  gap: string;
}
function blocks(markdown: string, ranges: BlockRanges): Block[] {
  let last = 0;
  return ranges(markdown).map(({ start, end }) => {
    const block = { text: markdown.slice(start, end), gap: markdown.slice(last, start) };
    last = end;
    return block;
  });
}

/**
 * @param original the text as it was loaded or last saved
 * @param canonical the editor's own rendering of `original`
 * @param next the editor's rendering now, after your edits
 * @returns `next`, with every unchanged block put back as it was in `original`
 */
export function preserveMarkdown(
  original: string,
  canonical: string,
  next: string,
  ranges: BlockRanges,
): string {
  if (next === canonical) return original;
  const from = blocks(original, ranges);
  const seen = blocks(canonical, ranges);
  // The two describe the same document, so they must line up block for block.
  if (from.length !== seen.length) return next;
  const now = blocks(next, ranges);
  let cursor = 0;
  let previous = -2;
  let out = '';
  now.forEach((block, index) => {
    let match = -1;
    for (let at = cursor; at < seen.length; at++)
      if (seen[at].text === block.text) {
        match = at;
        break;
      }
    let gap = index === 0 ? '' : '\n\n';
    let text = block.text;
    if (match >= 0) {
      cursor = match + 1;
      text = from[match].text;
      // Two neighbours that were neighbours before keep what separated them.
      if (index > 0 && previous === match - 1) gap = from[match].gap;
      previous = match;
    } else previous = -2;
    if (index === 0 && match === 0) gap = from[0].gap;
    out += gap + text;
  });
  const ending = /\s*$/.exec(original)?.[0] || '\n';
  return now.length ? out + (ending.includes('\n') ? ending : '\n') : '';
}
