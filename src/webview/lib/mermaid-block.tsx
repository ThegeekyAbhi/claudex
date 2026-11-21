import { useEffect, useRef, useState } from 'react';
import { enhanceDiagram } from './diagram-viewer';
import { diagramSvg, subscribeDiagramTheme } from './diagrams';
export function MermaidBlock({ source }: { source: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => subscribeDiagramTheme(() => setThemeVersion((value) => value + 1)), []);
  useEffect(() => {
    void themeVersion;
    let active = true;
    let dispose: (() => void) | undefined;
    setError(false);
    if (target.current) target.current.replaceChildren();
    void diagramSvg(source)
      .then((svg) => {
        const host = target.current;
        if (!active || !host) return;
        host.innerHTML = svg;
        const drawing = host.querySelector('svg');
        if (drawing) dispose = enhanceDiagram(drawing);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, [source, themeVersion]);
  return (
    <section className="my-3" aria-label="Mermaid diagram">
      <div ref={target} />
      <details open={error}>
        <summary>{error ? 'Diagram unavailable — view source' : 'Diagram source'}</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </section>
  );
}
