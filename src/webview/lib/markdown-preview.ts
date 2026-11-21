import './diagram-viewer.css';
import { enhanceDiagram } from './diagram-viewer';
import { diagramSvg, subscribeDiagramTheme } from './diagrams';

const rendered = new WeakMap<HTMLElement, { element: HTMLElement; dispose: () => void }>();
function clear(block: HTMLElement) {
  const previous = rendered.get(block);
  previous?.dispose();
  previous?.element.remove();
  rendered.delete(block);
}
let generation = 0;
async function renderDiagrams() {
  const current = ++generation;
  for (const block of Array.from(
    document.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  )) {
    try {
      const svg = await diagramSvg(block.textContent ?? '');
      if (current !== generation || !block.isConnected) return;
      clear(block);
      const diagram = document.createElement('div');
      diagram.setAttribute('role', 'group');
      diagram.setAttribute('aria-label', 'Mermaid diagram');
      diagram.innerHTML = svg;
      block.parentElement?.before(diagram);
      const drawing = diagram.querySelector('svg');
      rendered.set(block, {
        element: diagram,
        dispose: drawing ? enhanceDiagram(drawing) : () => undefined,
      });
    } catch {
      clear(block);
      // Keep the original source and the rest of the Markdown readable.
    }
  }
}
window.addEventListener('vscode.markdown.updateContent', () => void renderDiagrams());
subscribeDiagramTheme(() => void renderDiagrams());
void renderDiagrams();
