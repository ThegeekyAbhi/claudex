import { diagramSvg, subscribeDiagramTheme } from './diagrams';

const rendered = new WeakMap<HTMLElement, HTMLElement>();
let generation = 0;
async function renderDiagrams() {
  const current = ++generation;
  for (const block of Array.from(
    document.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  )) {
    try {
      const svg = await diagramSvg(block.textContent ?? '');
      if (current !== generation || !block.isConnected) return;
      rendered.get(block)?.remove();
      const diagram = document.createElement('div');
      diagram.setAttribute('role', 'img');
      diagram.setAttribute('aria-label', 'Mermaid diagram');
      diagram.style.overflowX = 'auto';
      diagram.innerHTML = svg;
      block.parentElement?.before(diagram);
      rendered.set(block, diagram);
    } catch {
      rendered.get(block)?.remove();
      // Keep the original source and the rest of the Markdown readable.
    }
  }
}
window.addEventListener('vscode.markdown.updateContent', () => void renderDiagrams());
subscribeDiagramTheme(() => void renderDiagrams());
void renderDiagrams();
