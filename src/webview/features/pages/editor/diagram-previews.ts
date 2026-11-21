import { enhanceDiagram } from '../../../lib/diagram-viewer';
import { diagramSvg, subscribeDiagramTheme } from '../../../lib/diagrams';

type Apply = (value: null | string | HTMLElement) => void;

/**
 * Mermaid code blocks draw as diagrams. Typing in the source redraws once you pause, and every
 * diagram redraws when the theme changes.
 *
 * Crepe sanitizes a preview into markup, so it gets the plain SVG; once that SVG is on the page it
 * is enhanced in place to pan and zoom. ProseMirror ignores mutations inside a code block's view.
 */
export function diagramPreviews(root: HTMLElement) {
  const diagrams = new Map<Apply, string>();
  const viewers = new Map<SVGSVGElement, () => void>();
  const enhance = () => {
    for (const [svg, dispose] of viewers)
      if (!svg.isConnected) {
        dispose();
        viewers.delete(svg);
      }
    for (const svg of Array.from(
      root.querySelectorAll<SVGSVGElement>('.milkdown-code-block .preview > svg'),
    ))
      viewers.set(svg, enhanceDiagram(svg));
  };
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true });
  const timers = new WeakMap<Apply, number>();
  const draw = (content: string, apply: Apply) => {
    window.clearTimeout(timers.get(apply));
    timers.set(
      apply,
      window.setTimeout(() => {
        diagramSvg(content).then(
          (svg) => apply(svg),
          (error: unknown) => apply(diagramError(error)),
        );
      }, 220),
    );
  };
  const unsubscribe = subscribeDiagramTheme(() => {
    for (const [apply, content] of diagrams) draw(content, apply);
  });
  return {
    /** Crepe's preview for a code block: a diagram for Mermaid, nothing for other code. */
    render(language: string, content: string, apply: Apply): null | undefined {
      if (language.toLowerCase() !== 'mermaid' || !content.trim()) return null;
      diagrams.set(apply, content);
      draw(content, apply);
      return undefined;
    },
    destroy() {
      unsubscribe();
      observer.disconnect();
      for (const dispose of viewers.values()) dispose();
      viewers.clear();
      diagrams.clear();
    },
  };
}

/** What a diagram that can't be drawn shows instead. */
function diagramError(error: unknown): HTMLElement {
  const box = document.createElement('div');
  box.className = 'page-diagram-error';
  const title = document.createElement('strong');
  title.textContent = 'This diagram can’t be drawn.';
  const detail = document.createElement('span');
  detail.textContent = error instanceof Error ? error.message.split('\n')[0] : '';
  box.append(title, detail);
  return box;
}
