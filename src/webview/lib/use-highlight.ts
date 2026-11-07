import { useEffect, useMemo, useState } from 'react';

type Engine = typeof import('./highlighter');
/** Grammars are large, so they load only once a thread shows code. */
let engine: Engine | null | undefined;
let loading: Promise<Engine | null> | undefined;
export function loadEngine(): Promise<Engine | null> {
  loading ??= import('./highlighter')
    .catch(() => null)
    .then((loaded) => {
      engine = loaded;
      return loaded;
    });
  return loading;
}
const LANGUAGE_NAMES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  yml: 'yaml',
  md: 'markdown',
  jsonc: 'json',
  json5: 'json',
  htm: 'html',
  svg: 'xml',
  plist: 'xml',
  golang: 'go',
  patch: 'diff',
  docker: 'dockerfile',
  conf: 'ini',
  cfg: 'ini',
};
/** The grammar name for a code fence's language or a file extension. */
export function languageName(language: string): string {
  const lower = language.toLowerCase();
  return LANGUAGE_NAMES[lower] ?? lower;
}
/** The language to colour a file in, from its name. */
export function languageOfPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? '';
  if (/^dockerfile$|^dockerfile\.|\.dockerfile$/i.test(base)) return 'dockerfile';
  if (/^\.(bash|zsh)rc$|^\.profile$/i.test(base)) return 'bash';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? languageName(base.slice(dot + 1)) : undefined;
}

export interface Token {
  content: string;
  /** The token's Light+ and Dark+ colours, left out where it is plain text. */
  light?: string;
  dark?: string;
}
/** `code` as coloured lines, or null when the language is unknown or the grammars haven't loaded. */
export function tokenize(code: string, language: string | undefined): Token[][] | null {
  if (!language || !engine) return null;
  const name = languageName(language);
  if (!engine.highlighter.getLoadedLanguages().includes(name)) return null;
  try {
    const { PLAIN, THEMES } = engine;
    return engine.highlighter
      .codeToTokens(code, { lang: name, themes: THEMES, defaultColor: false })
      .tokens.map((line) =>
        line.map((token) => {
          const style = (token.htmlStyle ?? {}) as Record<string, string>;
          const light = style['--shiki-light']?.toLowerCase();
          const dark = style['--shiki-dark']?.toLowerCase();
          return {
            content: token.content,
            light: light && light !== PLAIN.light ? light : undefined,
            dark: dark && dark !== PLAIN.dark ? dark : undefined,
          };
        }),
      );
  } catch {
    return null;
  }
}
/** Coloured lines once the grammars load; null until then, or when nothing can be coloured. */
export function useHighlight(code: string, language: string | undefined): Token[][] | null {
  const [ready, setReady] = useState(Boolean(engine));
  useEffect(() => {
    if (!language || ready) return;
    let current = true;
    void loadEngine().then(() => {
      if (current) setReady(true);
    });
    return () => {
      current = false;
    };
  }, [language, ready]);
  return useMemo(() => (ready ? tokenize(code, language) : null), [code, language, ready]);
}
/** A token's colours, as the variables the stylesheet reads. */
export function tokenStyle(token: Token): Record<string, string> | undefined {
  if (!token.light && !token.dark) return undefined;
  const style: Record<string, string> = {};
  if (token.light) style['--tok-light'] = token.light;
  if (token.dark) style['--tok-dark'] = token.dark;
  return style;
}
