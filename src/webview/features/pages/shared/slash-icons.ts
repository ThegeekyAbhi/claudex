/**
 * Icons for the page's `/` menu: thin outline glyphs, as in Notion's menu. Crepe draws an item's
 * icon as sanitized HTML beside its label, so each also carries the item's one-line description,
 * which the page's CSS places after the label.
 */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const GLYPHS = {
  text: svg('<path d="M5 6V5h14v1M12 5v14M9 19h6"/>'),
  h1: svg('<path d="M4 6v12M12 6v12M4 12h8M16 10l3-2v10"/>'),
  h2: svg('<path d="M4 6v12M12 6v12M4 12h8M16 10.5a2.5 2.5 0 1 1 4 2L16 18h4.5"/>'),
  h3: svg(
    '<path d="M4 6v12M12 6v12M4 12h8M16.5 8.5a2.3 2.3 0 1 1 2 4 2.3 2.3 0 1 1-2.2 3.5M18.5 12.5h-1"/>',
  ),
  quote: svg('<path d="M6 5v14M10 8h9M10 12h9M10 16h6"/>'),
  divider: svg('<path d="M4 12h16"/>'),
  bullets: svg(
    '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="18" r=".8"/>',
  ),
  numbers: svg('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 14h3l-3 4h3"/>'),
  todo: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>'),
  image: svg(
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20 16-4.5-4.5L7 19.5"/>',
  ),
  code: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
  table: svg(
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M10 10v9.5"/>',
  ),
  mention: svg(
    '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 8.5v5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',
  ),
  page: svg(
    '<path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3.5V9h5.5M8.5 13h7M8.5 16.5h4"/>',
  ),
  date: svg(
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M16 3v4M8 3v4M3.5 10h17"/>',
  ),
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The icon and description for one `/` menu item. */
export function slashIcon(glyph: keyof typeof GLYPHS, description: string): string {
  return `${GLYPHS[glyph]}<span class="slash-desc">${escapeHtml(description)}</span>`;
}

/** List markers drawn like Notion's: a thin rounded box, filled and ticked when done. */
export const LIST_ICONS = {
  bulletIcon:
    '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="2.4" fill="currentColor"/></svg>',
  checkBoxUncheckedIcon:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3" stroke="currentColor" stroke-width="1.5"/></svg>',
  checkBoxCheckedIcon:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor"/><path d="m4.6 8.2 2.3 2.3 4.6-5" stroke="var(--canvas, #fff)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
