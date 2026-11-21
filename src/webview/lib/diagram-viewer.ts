/**
 * Pan and zoom for a rendered diagram. `enhanceDiagram` wraps an SVG that is already on the page,
 * so every surface inserts its drawing however it must (React, Crepe's sanitized preview, VS
 * Code's Markdown preview) and then enhances the live element. Styles: diagram-viewer.css.
 *
 * Pointer: Ctrl/⌘ + scroll or a trackpad pinch zooms at the pointer; drag pans; double-click
 * zooms in, or back to fit. Plain scrolling scrolls the page, except in the expanded view, where
 * it pans. Keys while the drawing is focused: + / − zoom, 0 is 100%, 1 fits, arrows pan.
 */

const INLINE_MAX_HEIGHT = 480;
const PAD = 12;
const MAX_SCALE = 8;
const STEP = 1.25;
const PAN_STEP = 48;

const ICONS = {
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35M8 11h6"/>',
  fit: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
};

type Size = { width: number; height: number };

function iconButton(label: string, icon: string, onClick: () => void, signal: AbortSignal) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`;
  button.addEventListener('click', onClick, { signal });
  return button;
}

/** The drawing's own size: Mermaid sets a viewBox and a width of 100%. */
function naturalSize(svg: SVGSVGElement): Size {
  const box = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length === 4 && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 300, height: rect.height || 150 };
}

/**
 * Turns `svg` into a pannable, zoomable drawing in place. Returns a function that removes the
 * listeners and closes an open expanded view; the markup is left as it is.
 */
export function enhanceDiagram(
  svg: SVGSVGElement,
  options: { expanded?: boolean } = {},
): () => void {
  const expanded = options.expanded === true;
  const controller = new AbortController();
  const { signal } = controller;
  let closeExpanded: (() => void) | undefined;

  const root = document.createElement('div');
  root.className = 'diagram-viewer';
  if (expanded) root.dataset.expanded = 'true';
  const canvas = document.createElement('div');
  canvas.className = 'diagram-viewer-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-roledescription', 'diagram');
  canvas.setAttribute(
    'aria-label',
    'Diagram. Plus and minus zoom, 0 shows actual size, 1 fits, arrow keys pan.',
  );
  const stage = document.createElement('div');
  stage.className = 'diagram-viewer-stage';

  svg.replaceWith(root);
  stage.append(svg);
  canvas.append(stage);

  // Draw at true size and scale with the stage, so zooming never reflows the SVG.
  const size = naturalSize(svg);
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  svg.style.removeProperty('max-width');

  let scale = 1;
  let x = 0;
  let y = 0;
  let fit = 1;
  let userMoved = false;

  const readout = document.createElement('button');
  readout.type = 'button';
  readout.className = 'diagram-viewer-readout';
  readout.title = 'Actual size (0)';
  readout.setAttribute('aria-label', 'Zoom level; show actual size');
  readout.addEventListener('click', () => zoomTo(1), { signal });

  function centredOrClamped(offset: number, content: number, viewport: number) {
    if (content + PAD * 2 <= viewport) return (viewport - content) / 2;
    return Math.min(PAD, Math.max(viewport - content - PAD, offset));
  }

  function render() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    x = centredOrClamped(x, size.width * scale, width);
    y = centredOrClamped(y, size.height * scale, height);
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    readout.textContent = `${Math.round(scale * 100)}%`;
    canvas.dataset.pannable = String(
      size.width * scale + PAD * 2 > width + 0.5 || size.height * scale + PAD * 2 > height + 0.5,
    );
  }

  /** Recomputes the fitting scale; inline, the frame's height follows the fitted drawing. */
  function measure(): boolean {
    const width = canvas.clientWidth - PAD * 2;
    if (width <= 0) return false;
    if (expanded) {
      const height = canvas.clientHeight - PAD * 2;
      fit = Math.min(1, width / size.width, Math.max(1, height) / size.height);
    } else {
      fit = Math.min(1, width / size.width, (INLINE_MAX_HEIGHT - PAD * 2) / size.height);
      canvas.style.height = `${Math.ceil(size.height * fit + PAD * 2)}px`;
    }
    return true;
  }

  function fitView() {
    userMoved = false;
    if (!measure()) return;
    scale = fit;
    render();
  }

  /** Zooms to `next`, keeping the point under (px, py), or the centre, where it is. */
  function zoomTo(next: number, px = canvas.clientWidth / 2, py = canvas.clientHeight / 2) {
    const target = Math.min(MAX_SCALE, Math.max(Math.min(fit, 1) / 4, next));
    if (Math.abs(target - scale) < 1e-4) return;
    x = px - (px - x) * (target / scale);
    y = py - (py - y) * (target / scale);
    scale = target;
    userMoved = true;
    render();
  }

  function panBy(dx: number, dy: number) {
    x += dx;
    y += dy;
    userMoved = true;
    render();
  }

  function local(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  }

  canvas.addEventListener(
    'wheel',
    (event) => {
      const zoom = event.ctrlKey || event.metaKey;
      if (!zoom && !expanded) return;
      event.preventDefault();
      if (!zoom) return panBy(-event.deltaX, -event.deltaY);
      // Pinches arrive as small ctrl+wheel deltas, mouse wheels as large ones; cap both.
      const delta = Math.max(-40, Math.min(40, event.deltaY));
      zoomTo(scale * Math.exp(-delta * 0.01), ...local(event));
    },
    { passive: false, signal },
  );

  let drag: { id: number; x: number; y: number } | undefined;
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = 'true';
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (dx || dy) panBy(dx, dy);
    },
    { signal },
  );
  const endDrag = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener('pointerup', endDrag, { signal });
  canvas.addEventListener('pointercancel', endDrag, { signal });
  canvas.addEventListener(
    'dblclick',
    (event) => {
      event.preventDefault();
      if (scale > fit * 1.05) fitView();
      else zoomTo(Math.max(fit * 2, 1), ...local(event));
    },
    { signal },
  );
  canvas.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const actions: Record<string, () => void> = {
        '+': () => zoomTo(scale * STEP),
        '=': () => zoomTo(scale * STEP),
        '-': () => zoomTo(scale / STEP),
        _: () => zoomTo(scale / STEP),
        '0': () => zoomTo(1),
        '1': fitView,
        ArrowLeft: () => panBy(PAN_STEP, 0),
        ArrowRight: () => panBy(-PAN_STEP, 0),
        ArrowUp: () => panBy(0, PAN_STEP),
        ArrowDown: () => panBy(0, -PAN_STEP),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    },
    { signal },
  );

  const tools = document.createElement('div');
  tools.className = 'diagram-viewer-tools';
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', 'Diagram view');
  tools.append(
    iconButton('Zoom out (−)', ICONS.zoomOut, () => zoomTo(scale / STEP), signal),
    readout,
    iconButton('Zoom in (+)', ICONS.zoomIn, () => zoomTo(scale * STEP), signal),
    iconButton('Fit (1)', ICONS.fit, fitView, signal),
    expanded
      ? iconButton('Close', ICONS.close, () => root.closest('dialog')?.close(), signal)
      : iconButton(
          'Expand',
          ICONS.expand,
          () => {
            closeExpanded = openExpanded(svg, () => {
              closeExpanded = undefined;
              canvas.focus();
            });
          },
          signal,
        ),
  );
  root.append(canvas, tools);

  if (!expanded)
    canvas.style.height = `${Math.ceil(Math.min(INLINE_MAX_HEIGHT, size.height + PAD * 2))}px`;
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    const width = canvas.clientWidth;
    // Inline, the height follows the width; ignore the resize that height change causes.
    if (!width || (!expanded && width === lastWidth)) return;
    lastWidth = width;
    if (userMoved) {
      measure();
      render();
    } else fitView();
  });
  observer.observe(canvas);
  render();

  return () => {
    controller.abort();
    observer.disconnect();
    closeExpanded?.();
  };
}

/** Shows a copy of the drawing in a modal over the whole view. Returns a function to close it. */
function openExpanded(svg: SVGSVGElement, onClose: () => void): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-viewer-dialog';
  dialog.setAttribute('aria-label', 'Expanded diagram');
  const copy = svg.cloneNode(true) as SVGSVGElement;
  dialog.append(copy);
  document.body.append(dialog);
  const dispose = enhanceDiagram(copy, { expanded: true });
  // A click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dispose();
    dialog.remove();
    onClose();
  });
  dialog.showModal();
  dialog.querySelector<HTMLElement>('.diagram-viewer-canvas')?.focus();
  return () => dialog.close();
}
