import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { nodeViewCtx } from '@milkdown/kit/core';
import type { Node } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';

/**
 * Page images, sized the way Notion sizes them: left-aligned with the text, with handles on both
 * sides that set the width. Crepe's own view sizes by height and centres the image; this one
 * replaces it once an image has a source, and leaves Crepe's upload-or-link prompt for empty ones.
 *
 * The width lives in Crepe's existing `ratio` attribute, written as the image's alt text
 * (`![0.45](src)`), so pages stay plain Markdown: below 1 it is a share of the page column, and
 * 1 means the image's own size, never wider than the column.
 */

/** Narrowest an image can be dragged, in CSS pixels. */
export const MIN_IMAGE_WIDTH = 80;
/** Tallest a newly added image starts, in CSS pixels; drag it bigger if you want. */
export const DEFAULT_IMAGE_HEIGHT = 360;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The `ratio` for an image drawn `width` pixels wide in a `column`-pixel page. A full-width image
 * is 1 (its own size) unless it is smaller than the column, as 1 would then shrink it back.
 */
export function widthFraction(width: number, column: number, natural: number): number {
  if (column <= 0) return 1;
  const share = round(Math.min(1, Math.max(MIN_IMAGE_WIDTH, width) / column));
  if (share < 1) return Math.max(0.01, share);
  return natural >= column ? 1 : 0.99;
}

/**
 * The starting `ratio` for a pasted or uploaded image. A screenshot carries `dpr`× the pixels of
 * the screen it came from, so it starts at its on-screen size, no taller than
 * DEFAULT_IMAGE_HEIGHT and no wider than the column.
 */
export function defaultFraction(
  natural: { width: number; height: number },
  column: number,
  dpr: number,
): number {
  if (natural.width <= 0 || natural.height <= 0 || column <= 0) return 1;
  const width = Math.min(
    natural.width / Math.max(1, dpr),
    (DEFAULT_IMAGE_HEIGHT * natural.width) / natural.height,
    column,
  );
  // Its own size already fits: nothing to store.
  if (width >= Math.min(natural.width, column) - 0.5) return 1;
  return widthFraction(width, column, natural.width);
}

const ICONS = {
  caption:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  expand:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Shows an image at its own size over the page; Esc or a click closes it. */
export function openImageViewer(src: string, alt: string, onClose: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'page-image-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', alt || 'Image');
  overlay.tabIndex = -1;
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt;
  overlay.append(image);
  const close = () => {
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  overlay.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  overlay.focus();
}

function button(label: string, icon: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'page-image-action';
  element.title = label;
  element.setAttribute('aria-label', label);
  element.innerHTML = icon;
  return element;
}

class ImageView implements NodeView {
  dom: HTMLElement;
  private node: Node;
  private readonly frame: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLInputElement;
  private readonly broken: HTMLElement;
  private dragging = false;

  constructor(
    node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly imageUrl: (src: string) => string,
    private readonly fresh: Set<string>,
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'milkdown-image-block page-image';
    this.frame = document.createElement('div');
    this.frame.className = 'page-image-frame';
    this.image = document.createElement('img');
    this.image.draggable = false;
    this.image.addEventListener('load', () => this.loaded());
    this.image.addEventListener('error', () => this.dom.classList.add('is-broken'));
    this.broken = document.createElement('div');
    this.broken.className = 'page-image-broken';

    const actions = document.createElement('div');
    actions.className = 'page-image-actions';
    const captionButton = button('Caption', ICONS.caption);
    captionButton.addEventListener('click', () => {
      this.dom.classList.add('has-caption');
      this.caption.focus();
    });
    const expand = button('View full size', ICONS.expand);
    expand.addEventListener('click', () => this.expand());
    actions.append(captionButton, expand);

    this.frame.append(this.image, this.broken, actions, this.handle('left'), this.handle('right'));
    this.frame.addEventListener('dblclick', () => this.expand());

    this.caption = document.createElement('input');
    this.caption.className = 'page-image-caption';
    this.caption.placeholder = 'Add a caption';
    this.caption.setAttribute('aria-label', 'Caption');
    this.caption.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        this.caption.blur();
        view.focus();
      }
    });
    this.caption.addEventListener('blur', () => {
      if (this.caption.value !== this.node.attrs.caption)
        this.setAttr('caption', this.caption.value);
      if (!this.caption.value) this.dom.classList.remove('has-caption');
    });

    this.dom.append(this.frame, this.caption);
    this.render();
  }

  private handle(side: 'left' | 'right'): HTMLElement {
    const handle = document.createElement('div');
    handle.className = `page-image-handle is-${side}`;
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', (event) => {
      if (!this.view.editable || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = this.frame.getBoundingClientRect().width;
      const column = this.column();
      let width = startWidth;
      this.dragging = true;
      this.dom.classList.add('is-resizing');
      const move = (next: PointerEvent) => {
        const delta = next.clientX - startX;
        width = Math.min(
          column,
          Math.max(MIN_IMAGE_WIDTH, startWidth + (side === 'right' ? delta : -delta)),
        );
        this.frame.style.width = `${width}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.dragging = false;
        this.dom.classList.remove('is-resizing');
        const ratio = widthFraction(width, column, this.image.naturalWidth);
        if (ratio !== this.node.attrs.ratio) this.setAttr('ratio', ratio);
        else this.render();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    return handle;
  }

  /** The page column's width: the editor's, as images are top-level blocks. */
  private column(): number {
    return this.view.dom.clientWidth;
  }

  private loaded(): void {
    this.dom.classList.remove('is-broken');
    const src = this.node.attrs.src as string;
    if (!this.fresh.has(src)) return;
    this.fresh.delete(src);
    if (this.node.attrs.ratio !== 1) return;
    const ratio = defaultFraction(
      { width: this.image.naturalWidth, height: this.image.naturalHeight },
      this.column(),
      window.devicePixelRatio || 1,
    );
    // Right after the paste, so history keeps it in the same undo step.
    if (ratio !== 1) this.setAttr('ratio', ratio);
  }

  private expand(): void {
    if (this.dom.classList.contains('is-broken')) return;
    openImageViewer(this.image.src, this.node.attrs.caption as string, () => this.view.focus());
  }

  private setAttr(name: 'ratio' | 'caption', value: number | string): void {
    if (!this.view.editable) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, name, value));
  }

  private render(): void {
    const { src, caption, ratio } = this.node.attrs as {
      src: string;
      caption: string;
      ratio: number;
    };
    const url = this.imageUrl(src);
    if (this.image.getAttribute('src') !== url) this.image.src = url;
    this.image.alt = caption;
    this.broken.textContent = `Image couldn’t load: ${src}`;
    this.frame.style.width = ratio > 0 && ratio < 1 ? `${round(ratio * 100)}%` : '';
    this.dom.classList.toggle('is-sized', ratio > 0 && ratio < 1);
    this.dom.classList.toggle('is-readonly', !this.view.editable);
    this.caption.readOnly = !this.view.editable;
    if (document.activeElement !== this.caption) this.caption.value = caption;
    this.dom.classList.toggle('has-caption', Boolean(caption));
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type || !node.attrs.src) return false;
    this.node = node;
    if (!this.dragging) this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    return Boolean(
      target?.closest?.('.page-image-handle, .page-image-actions, .page-image-caption'),
    );
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/**
 * The image view for pages. `fresh` holds the sources of images added in this session, which
 * start at their default size once they load.
 */
export function pageImageView(imageUrl: (src: string) => string, fresh: Set<string>) {
  return $view(imageBlockSchema.node, (ctx): NodeViewConstructor => {
    // Crepe's view, registered before this one; it still draws empty images.
    const crepe = ctx.get(nodeViewCtx).find(([id]) => id === 'image-block')?.[1];
    return (node, view, getPos, decorations, inner) => {
      if (node.attrs.src || !crepe) return new ImageView(node, view, getPos, imageUrl, fresh);
      const empty = crepe(node, view, getPos, decorations, inner);
      const update = empty.update?.bind(empty);
      // Once it has a source, the image is redrawn by this view.
      empty.update = (next, ...rest) =>
        next.attrs.src ? false : (update?.(next, ...rest) ?? false);
      return empty;
    };
  });
}
