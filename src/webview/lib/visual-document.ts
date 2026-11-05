/** No `allow-scripts`, so nothing an agent writes can run. Same-origin only lets us measure height. */
export const VISUAL_SANDBOX = 'allow-same-origin';
export const VISUAL_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
export const VISUAL_MAX_SOURCE = 200_000;
export const VISUAL_MAX_HEIGHT = 900;
/** Semantic tokens an agent's visual can use, by the names the explanation guide gives it. */
export const VISUAL_TOKENS = [
  'canvas',
  'surface',
  'raised',
  'foreground',
  'muted',
  'faint',
  'border',
  'accent',
  'link',
  'success',
  'warning',
  'error',
  'mono',
] as const;
export interface VisualTheme {
  tokens: Partial<Record<(typeof VISUAL_TOKENS)[number], string>>;
  font: string;
  colorScheme: string;
}
/** Theme values are CSS, so anything that could end the style element is left out. */
function cssValue(value: string): string {
  return value.replace(/[<>{};]/g, '');
}
const BASE = `
html { background: transparent; color: var(--foreground); }
body { display: flow-root; margin: 0; font-size: 13px; line-height: 1.55; }
* { box-sizing: border-box; }
svg { max-width: 100%; height: auto; }
code { font-family: var(--mono); font-size: 0.92em; }
a { color: var(--link); }
.card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 12px 14px; margin: 8px 0; }
.flow { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; margin: 8px 0; }
.node { flex: 1 1 120px; border: 1px solid var(--border); border-radius: 8px; background: var(--raised); padding: 8px 10px; }
.arrow { align-self: center; color: var(--muted); }
.muted { color: var(--muted); }
.fade-in { animation: visual-fade 320ms ease-out both; }
.dash-flow { stroke-dasharray: 6 6; animation: visual-dash 900ms linear infinite; }
@keyframes visual-fade { from { opacity: 0; transform: translateY(4px); } }
@keyframes visual-dash { to { stroke-dashoffset: -12; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}`;
/** The policy comes first, so it is in force before the browser parses anything the agent wrote. */
export function visualDocument(source: string, theme: VisualTheme): string {
  const tokens = Object.entries(theme.tokens)
    .map(([name, value]) => `--${name}: ${cssValue(value ?? '')};`)
    .join(' ');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${VISUAL_POLICY}"><meta charset="utf-8"><style>:root { color-scheme: ${cssValue(theme.colorScheme)}; ${tokens} font-family: ${cssValue(theme.font)}; }${BASE}</style></head><body>${source}</body></html>`;
}
