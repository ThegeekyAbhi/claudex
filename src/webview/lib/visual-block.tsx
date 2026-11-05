import { useEffect, useMemo, useRef, useState } from 'react';
import { send } from '../app/bridge';
import { Icon } from '../components/icons';
import { subscribeDiagramTheme } from './diagrams';
import {
  VISUAL_MAX_HEIGHT,
  VISUAL_SANDBOX,
  VISUAL_TOKENS,
  type VisualTheme,
  visualDocument,
} from './visual-document';

function readTheme(): VisualTheme {
  const style = getComputedStyle(document.body);
  return {
    tokens: Object.fromEntries(
      VISUAL_TOKENS.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]),
    ),
    font: style.fontFamily,
    colorScheme: style.colorScheme || 'dark',
  };
}
/** Shown until the fence closes, so half-written markup never renders. */
export function VisualPlaceholder() {
  return (
    <output className="my-3 flex items-center gap-2 rounded-[8px] border border-subtle bg-surface px-3 py-6 text-xs text-muted-foreground">
      <Icon name="logo" size={13} />
      <span className="shimmer">Drawing a visual…</span>
    </output>
  );
}
export function VisualBlock({ source }: { source: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const [themeVersion, setThemeVersion] = useState(0);
  const [height, setHeight] = useState(120);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => subscribeDiagramTheme(() => setThemeVersion((value) => value + 1)), []);
  useEffect(() => () => cleanup.current?.(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is read when it changes
  const html = useMemo(() => visualDocument(source, readTheme()), [source, themeVersion]);
  function attach() {
    cleanup.current?.();
    cleanup.current = undefined;
    const content = frame.current?.contentDocument;
    if (!content?.body) {
      setFailed(true);
      return;
    }
    setFailed(false);
    const measure = () =>
      setHeight(
        Math.min(VISUAL_MAX_HEIGHT, Math.ceil(content.body.getBoundingClientRect().height)),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content.body);
    // Links go through the host's usual handling, never by navigating the frame.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href');
      if (href) send({ type: 'link', href: href.slice(0, 4096) });
    };
    content.addEventListener('click', onClick);
    cleanup.current = () => {
      observer.disconnect();
      content.removeEventListener('click', onClick);
    };
    // CSS can't reach SVG's own animation elements.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      for (const svg of Array.from(content.querySelectorAll('svg'))) svg.pauseAnimations();
    setLoaded(true);
  }
  return (
    <section className="my-3" aria-label="Visual explanation">
      {failed ? null : (
        <iframe
          ref={frame}
          title="Visual explanation"
          sandbox={VISUAL_SANDBOX}
          srcDoc={html}
          onLoad={attach}
          style={{ height }}
          className={`block w-full border-0 transition-opacity duration-200 motion-reduce:transition-none ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      <details open={failed} className="text-[11px] text-muted-foreground">
        <summary>{failed ? 'Visual unavailable — view source' : 'View source'}</summary>
        <button
          type="button"
          aria-label="Copy visual source"
          className="my-1 px-[5px] py-[3px] text-muted-foreground"
          onClick={() => send({ type: 'copy', text: source })}
        >
          <Icon name="copy" size={12} />
        </button>
        <pre className="max-h-[360px] overflow-auto">
          <code>{source}</code>
        </pre>
      </details>
    </section>
  );
}
