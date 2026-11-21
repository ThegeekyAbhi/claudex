/**
 * Page front matter: the small block at the top of a page that holds its icon, pin and author.
 * Keys you wrote yourself are kept as they are.
 */

export const PAGE_ICONS = [
  '📝',
  '📘',
  '✅',
  '🎯',
  '🧭',
  '🐛',
  '🚀',
  '🧪',
  '💡',
  '📌',
  '🗂️',
  '🔍',
  '🛠️',
  '📅',
  '⭐',
  '🔥',
] as const;

export interface PageMeta {
  icon?: string;
  pinned?: boolean;
  /** Set when an agent created the page. */
  by?: 'agent';
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/** Front matter, if the page starts with one, and the Markdown after it. */
export function splitFrontMatter(text: string): { front: string; body: string; meta: PageMeta } {
  const match = FRONT.exec(text);
  if (!match) return { front: '', body: text, meta: {} };
  const meta: PageMeta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    if (key === 'icon' && value) meta.icon = unquote(value).slice(0, 16);
    if (key === 'pinned') meta.pinned = value === 'true';
    if (key === 'by' && unquote(value) === 'agent') meta.by = 'agent';
  }
  // Blank lines after the front matter belong to it, so the body starts with content.
  let end = match[0].length;
  while (text[end] === '\n' || text[end] === '\r') end++;
  return { front: text.slice(0, end), body: text.slice(end), meta };
}
function unquote(value: string): string {
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}
/**
 * The page with its front matter changed. Keys you wrote yourself are kept; ours are
 * replaced or removed, and an empty block is dropped.
 */
export function withPageMeta(text: string, patch: PageMeta): string {
  const { front, body, meta } = splitFrontMatter(text);
  const next = { ...meta, ...patch };
  const own = new Set(['icon', 'pinned', 'by']);
  const kept = front
    ? (FRONT.exec(front)?.[1] ?? '')
        .split(/\r?\n/)
        .filter((line) => !own.has(/^([a-z]+):/.exec(line)?.[1] ?? ''))
        .filter((line) => line.trim())
    : [];
  const lines = [
    ...(next.icon ? [`icon: ${next.icon}`] : []),
    ...(next.pinned ? ['pinned: true'] : []),
    ...(next.by ? [`by: ${next.by}`] : []),
    ...kept,
  ];
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n${body}` : body;
}
