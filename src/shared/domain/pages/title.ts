/**
 * A page's name: its first `# heading`, and the file and slug names made from it.
 */

export const PAGE_TITLE_LIMIT = 200;

/** The page's name: its first top-level heading, else its first line of text. */
export function pageTitle(body: string): string {
  let fence = false;
  let first = '';
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return plain(heading[1]);
    if (!first && line.trim()) first = plain(line.replace(/^\s*(?:[-*+]|\d+[.)]|>|#+)\s*/, ''));
  }
  return first || 'Untitled';
}
function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .trim()
    .slice(0, PAGE_TITLE_LIMIT);
}

export function newPageTemplate(title = ''): string {
  return `# ${title.trim()}\n\n`;
}
export function pageSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'page'
  );
}

/**
 * The page's name as a file name, for its editor tab and breadcrumb: the title without
 * characters a path can't hold. The id travels separately, so two pages may share a name.
 */
export function pageFileName(title: string): string {
  const name = title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed.
    .replace(/[\u0000-\u001f\\/:*?"<>|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return `${name || 'Untitled'}.md`;
}
