import { useEffect } from 'react';
import type {
  PageHostMessage,
  PagesHostMessage,
  PagesListAction,
  PageViewAction,
} from '../../../../shared/protocol/pages';
import { api } from '../../../app/bridge';

/** Messages from the Pages side bar and page editors. The host validates every one. */
export function post(action: PagesListAction | PageViewAction): void {
  api?.postMessage(action);
}
export function useHostMessages<T extends PageHostMessage | PagesHostMessage>(
  receive: (message: T) => void,
): void {
  useEffect(() => {
    const listener = (event: MessageEvent<T>) => {
      if (event.data && typeof event.data === 'object' && 'type' in event.data) receive(event.data);
    };
    window.addEventListener('message', listener);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, [receive]);
}

/** A link from one page to another, as a relative path so it works in any Markdown viewer. */
export function pageHref(from: string | undefined, to: string): string {
  const fromDir = from?.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const toDir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
  const name = `${to.slice(to.lastIndexOf('/') + 1)}.md`;
  if (fromDir === toDir) return `./${name}`;
  if (!fromDir) return `${toDir}/${name}`;
  return toDir ? `../${toDir}/${name}` : `../${name}`;
}
/** The page a relative link points at, or undefined when it isn't a page link. */
export function pageFromHref(from: string | undefined, href: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !href.endsWith('.md')) return undefined;
  const parts = (from?.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : []).concat(
    decodeURIComponent(href).replace(/\.md$/, '').split('/'),
  );
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.' || !part) continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/') || undefined;
}
