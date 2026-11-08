/** Headings that name a section, not the plan, so they don't stand in for its title. */
const GENERIC = /^(?:the )?(?:plan|implementation plan|context|overview|summary|goals?)$/i;
/** A short name for the plan: its first heading that says what it is about. */
export function planTitle(text: string): string {
  for (const line of text.split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading?.[1]) continue;
    const title = heading[1]
      .replace(/[*_`]/g, '')
      .replace(/^(?:implementation )?plan\s*[:—–-]\s*/i, '')
      .trim();
    if (title && !GENERIC.test(title)) return title;
  }
  return '';
}
