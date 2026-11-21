/**
 * Edits an agent suggests to a page, and the smallest change between two texts.
 */

/** One change an agent proposes: replace exactly one occurrence of `find`. */
export interface PageEdit {
  find: string;
  replace: string;
}
export interface PageSuggestion {
  id: string;
  pageId: string;
  edits: PageEdit[];
  note?: string;
  /** The agent profile that suggested it, for its name and mark. */
  agent: string;
  threadId?: string;
  createdAt: number;
}
export class SuggestionStale extends Error {
  constructor(readonly find: string) {
    super('The page changed since this was suggested, so it no longer fits.');
    this.name = 'SuggestionStale';
  }
}

/** The offset of a single match, counting overlapping occurrences as separate matches. */
export function uniqueMatchOffset(text: string, find: string): number | undefined {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) return undefined;
  return at;
}

/** The text with one suggested edit applied, if its `find` occurs exactly once. */
export function applyPageEdit(text: string, edit: PageEdit): string {
  if (!edit.find) {
    // An empty find appends, so an agent can add a section to the end.
    return `${text.replace(/\s*$/, '')}\n\n${edit.replace.trim()}\n`;
  }
  const at = uniqueMatchOffset(text, edit.find);
  if (at === undefined) throw new SuggestionStale(edit.find);
  return text.slice(0, at) + edit.replace + text.slice(at + edit.find.length);
}
/** Whether each edit still applies to the text as it is now. */
export function editFits(text: string, edit: PageEdit): boolean {
  return !edit.find || uniqueMatchOffset(text, edit.find) !== undefined;
}

/** The smallest single replacement that turns `before` into `after`. */
export function textChange(
  before: string,
  after: string,
): { start: number; end: number; text: string } | undefined {
  if (before === after) return undefined;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { start, end: endBefore, text: after.slice(start, endAfter) };
}
