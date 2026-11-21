import { FileIcon } from '@react-symbols/icons/utils';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const icons = new Map<string, string>();

/** The same file-type icon the composer's file chips show, as an image the page's CSS can draw. */
export function fileIconUrl(name: string): string {
  const key = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : name;
  let url = icons.get(key);
  if (!url) {
    const svg = renderToStaticMarkup(
      createElement(FileIcon, { fileName: name, autoAssign: true, width: 14, height: 14 }),
    );
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    icons.set(key, url);
  }
  return url;
}
