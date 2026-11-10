import { Children, isValidElement, memo, type ReactElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remend from 'remend';
import type { Attachment } from '../../shared/model';
import { send } from '../app/bridge';
import { Icon } from '../components/icons';
import { ReferenceIcon } from '../components/reference-icon';
import { ColouredLines } from './coloured-lines';
import { MermaidBlock } from './mermaid-block';
import { remarkReferences } from './remark-references';
import { useHighlight } from './use-highlight';
import { VisualBlock, VisualPlaceholder } from './visual-block';
import { VISUAL_MAX_SOURCE } from './visual-document';

function Highlighted({ code, language }: { code: string; language: string }) {
  const lines = useHighlight(code, language || undefined);
  if (!lines) return <code>{code}</code>;
  return (
    <code>
      <ColouredLines lines={lines} />
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
    <div
      className={`callout my-[0.9em] px-3 py-2 border border-subtle border-l-2 border-l-link rounded-md bg-raised [&>p]:mt-[0.2em] [&>p]:mb-0 [&>p:last-child]:mb-0 [&.tip]:border-l-success [&.warning]:border-l-warning [&.important]:border-l-warning [&.caution]:border-l-error ${match[1].toLowerCase()}`}
    >
      <div className="text-[11.5px] font-semibold text-link in-[.callout.tip]:text-success in-[.callout.warning]:text-warning in-[.callout.important]:text-warning in-[.callout.caution]:text-error">
        {match[1][0] + match[1].slice(1).toLowerCase()}
      </div>
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
function components(streaming: boolean, attachments?: Attachment[]): Components {
  return {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    blockquote: Blockquote,
    span: ({ children, className, title }) => {
      const attachment = className?.includes('inline-reference')
        ? attachments?.find(
            (item) => (item.kind === 'file' || item.kind === 'folder') && item.path === title,
          )
        : undefined;
      return (
        <span className={className} title={title}>
          {attachment && (attachment.kind === 'file' || attachment.kind === 'folder') ? (
            <ReferenceIcon kind={attachment.kind} path={attachment.path} />
          ) : null}
          {attachment ? <span className="reference-label">{children}</span> : children}
        </span>
      );
    },
    // Remote images could reveal activity to a server, so they stay as text.
    img: ({ alt }) => <span className="text-muted-foreground">[Image: {alt || 'attachment'}]</span>,
    a: ({ href, children }) => (
      <button
        type="button"
        className="inline p-0 border-0 text-[inherit] wrap-anywhere"
        onClick={() => {
          if (href) send({ type: 'link', href });
        }}
      >
        {children}
      </button>
    ),
    table: ({ children }) => (
      <div className="my-[0.9em] overflow-x-auto border border-subtle rounded-[8px]">
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
      if (language === 'mermaid' && !streaming) return <MermaidBlock source={text} />;
      if (language === 'visual' && text.length <= VISUAL_MAX_SOURCE)
        return streaming ? <VisualPlaceholder /> : <VisualBlock source={text} />;
      return (
        <div className="code-block my-[0.9em] border border-subtle rounded-[8px] bg-surface overflow-hidden">
          <div className="flex items-center justify-between pt-0.5 pr-1 pb-0.5 pl-2.5 border-b border-subtle text-[11px] text-faint [&_button]:px-[5px] [&_button]:py-[3px] [&_button]:text-muted-foreground">
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
            className="inline p-0 border-0 text-[inherit] text-start whitespace-normal [&_code]:text-link enabled:hover:bg-transparent enabled:hover:underline enabled:hover:decoration-link"
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
  attachments,
}: {
  text: string;
  /** Repairs half-written syntax and holds off on highlighting until the text settles. */
  streaming?: boolean;
  attachments?: Attachment[];
}) {
  let renderers = streaming ? STREAMING : SETTLED;
  if (attachments?.length) renderers = components(streaming, attachments);
  return (
    <Markdown
      remarkPlugins={
        attachments?.length ? [...PLUGINS, [remarkReferences, { attachments }]] : PLUGINS
      }
      skipHtml
      components={renderers}
    >
      {streaming ? remend(text) : text}
    </Markdown>
  );
});
