import { Children, isValidElement, memo, type ReactElement, type ReactNode, useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remend from 'remend';
import {
  createCssVariablesTheme,
  createHighlighterCoreSync,
  type HighlighterCore,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from 'shiki/langs/bash.mjs';
import css from 'shiki/langs/css.mjs';
import diff from 'shiki/langs/diff.mjs';
import go from 'shiki/langs/go.mjs';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import python from 'shiki/langs/python.mjs';
import rust from 'shiki/langs/rust.mjs';
import sql from 'shiki/langs/sql.mjs';
import swift from 'shiki/langs/swift.mjs';
import toml from 'shiki/langs/toml.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import { send } from './bridge';
import { Icon } from './icons';

/** Colors come from CSS variables, so code follows the light, dark, and high-contrast tokens. */
const THEME = 'agent-workspace';
let highlighter: HighlighterCore | null | undefined;
function getHighlighter(): HighlighterCore | null {
  if (highlighter === undefined) {
    try {
      highlighter = createHighlighterCoreSync({
        themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--code-' })],
        langs: [
          bash,
          css,
          diff,
          go,
          html,
          javascript,
          json,
          jsx,
          markdown,
          python,
          rust,
          sql,
          swift,
          toml,
          tsx,
          typescript,
          yaml,
        ],
        // The default engine needs WebAssembly, which this webview's policy does not allow.
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    } catch {
      highlighter = null;
    }
  }
  return highlighter;
}
const LANGUAGE_NAMES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  patch: 'diff',
};
function Highlighted({ code, language }: { code: string; language: string }) {
  const lines = useMemo(() => {
    const engine = language ? getHighlighter() : null;
    const name = LANGUAGE_NAMES[language] ?? language;
    if (!engine?.getLoadedLanguages().includes(name)) return null;
    try {
      return engine.codeToTokens(code, { lang: name, theme: THEME }).tokens;
    } catch {
      return null;
    }
  }, [code, language]);
  if (!lines) return <code>{code}</code>;
  return (
    <code>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond their order
        <span key={index}>
          {line.map((token) => (
            <span key={token.offset} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
          {index < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </code>
  );
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
/** Headings, ignoring anything inside a code fence, for a long plan's outline. */
export function outlineOf(text: string): { level: number; title: string; slug: string }[] {
  const items: { level: number; title: string; slug: string }[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (match) {
      const title = match[2].replace(/[*_`]/g, '');
      items.push({ level: match[1].length, title, slug: slug(title) });
    }
  }
  return items;
}
const PATH = /^(?:[\w.@-]+\/)+[\w.@-]+(?::\d+)?$|^[\w@-][\w.@-]*\.[a-z][a-z0-9]{0,5}(?::\d+)?$/i;
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;
/** Reads GitHub's `> [!NOTE]` syntax. */
function Blockquote({ children }: { children?: ReactNode }) {
  const parts = Children.toArray(children);
  const firstIndex = parts.findIndex(isValidElement);
  const first = parts[firstIndex] as ReactElement<{ children?: ReactNode }> | undefined;
  const inner = first ? Children.toArray(first.props.children) : [];
  const match = typeof inner[0] === 'string' ? CALLOUT.exec(inner[0]) : null;
  if (!first || !match) return <blockquote>{children}</blockquote>;
  const rest = [(inner[0] as string).slice(match[0].length), ...inner.slice(1)];
  return (
    <div className={`callout ${match[1].toLowerCase()}`}>
      <div className="callout-title">{match[1][0] + match[1].slice(1).toLowerCase()}</div>
      {rest.some((item) => item !== '') ? <p>{rest}</p> : null}
      {parts.slice(firstIndex + 1)}
    </div>
  );
}
function heading(Tag: 'h1' | 'h2' | 'h3') {
  return ({ children }: { children?: ReactNode }) => (
    <Tag data-slug={slug(textOf(children))}>{children}</Tag>
  );
}
function components(streaming: boolean): Components {
  return {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    blockquote: Blockquote,
    // Remote images could reveal activity to a server, so they stay as text.
    img: ({ alt }) => <span className="muted">[Image: {alt || 'attachment'}]</span>,
    a: ({ href, children }) => (
      <button
        type="button"
        className="text-link"
        onClick={() => {
          if (href) send({ type: 'link', href });
        }}
      >
        {children}
      </button>
    ),
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }) => {
      const code = Children.toArray(children)[0];
      const props = isValidElement(code)
        ? (code.props as { className?: string; children?: ReactNode })
        : {};
      const language = /language-([\w-]+)/.exec(props.className ?? '')?.[1] ?? '';
      const text = textOf(props.children).replace(/\n$/, '');
      return (
        <div className="code-block">
          <div className="code-header">
            <span>{language || 'text'}</span>
            <button
              type="button"
              aria-label="Copy code"
              disabled={streaming}
              onClick={() => send({ type: 'copy', text })}
            >
              <Icon name="copy" size={12} />
            </button>
          </div>
          <pre>
            {streaming ? <code>{text}</code> : <Highlighted code={text} language={language} />}
          </pre>
        </div>
      );
    },
    code: ({ className, children }) => {
      const text = textOf(children);
      if (!className && PATH.test(text))
        return (
          <button
            type="button"
            className="code-link"
            onClick={() => send({ type: 'link', href: encodeURI(text) })}
          >
            <code>{children}</code>
          </button>
        );
      return <code className={className}>{children}</code>;
    },
  };
}
const SETTLED = components(false);
const STREAMING = components(true);
const PLUGINS = [remarkGfm];
export const MarkdownText = memo(function MarkdownText({
  text,
  streaming = false,
}: {
  text: string;
  /** Repairs half-written syntax and holds off on highlighting until the text settles. */
  streaming?: boolean;
}) {
  return (
    <Markdown remarkPlugins={PLUGINS} skipHtml components={streaming ? STREAMING : SETTLED}>
      {streaming ? remend(text) : text}
    </Markdown>
  );
});
