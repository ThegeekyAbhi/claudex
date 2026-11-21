import { type RefObject, useCallback, useEffect, useRef } from 'react';
import {
  editFits,
  type PageSuggestion,
  profileLabel,
  splitFrontMatter,
} from '../../../../shared/model';
import { preserveMarkdown } from '../editor/preserve';
import { placeEdit } from '../editor/review-diff';
import type { PageEditor, ReviewChange } from '../editor/types';
import { post } from '../shared/page-bridge';

/** How long typing settles before the page is sent to VS Code's document. */
const SEND_MS = 180;

/**
 * Keeps the editor and VS Code's document in step. Your edits go to the host after a short
 * pause (or at once when you leave), with the blocks you didn't touch kept as you wrote them;
 * changes from elsewhere replace the editor's text. Suggested edits are drawn where they apply.
 */
export function usePageSync(
  editor: RefObject<PageEditor | undefined>,
  onExternal: (instance: PageEditor) => void,
) {
  /** What VS Code's document holds, and the two texts that keep your Markdown as you wrote it. */
  const sync = useRef({ host: '', front: '', original: '', canonical: '', next: '', timer: 0 });
  /** The suggestions shown, so edits that arrive while you type stay placed. */
  const shown = useRef<PageSuggestion[]>([]);

  /** Places each suggested edit where it applies in the page, for review in place. */
  const showChanges = useCallback(() => {
    const instance = editor.current;
    if (!instance) return;
    const body = sync.current.original;
    const blocks = instance.ranges(body);
    const changes: ReviewChange[] = [];
    for (const suggestion of shown.current)
      suggestion.edits.forEach((edit, index) => {
        if (!editFits(sync.current.host, edit)) return;
        const place = placeEdit(body, blocks, edit);
        if (place)
          changes.push({
            key: `${suggestion.id}:${index}`,
            agent: profileLabel(suggestion.agent),
            place,
          });
      });
    instance.setChanges(changes);
  }, [editor]);

  /** Sends a pending edit now. */
  const flush = useCallback(() => {
    const current = sync.current;
    if (!current.timer) return;
    window.clearTimeout(current.timer);
    current.timer = 0;
    const instance = editor.current;
    if (!instance) return;
    const merged = preserveMarkdown(
      current.original,
      current.canonical,
      current.next,
      instance.ranges,
    );
    current.original = merged;
    current.canonical = current.next;
    const text = current.front + merged;
    if (text === current.host) return;
    current.host = text;
    post({ type: 'pageEdit', text });
    showChanges();
  }, [editor, showChanges]);

  /** The editor's Markdown changed: send it once typing settles. */
  const changed = useCallback(
    (markdown: string) => {
      sync.current.next = markdown;
      window.clearTimeout(sync.current.timer);
      sync.current.timer = window.setTimeout(flush, SEND_MS);
    },
    [flush],
  );

  /** The document changed outside the editor: show it, unless it is only our own edit. */
  const external = useCallback(
    (text: string) => {
      const current = sync.current;
      if (text === current.host) return;
      flush();
      current.host = text;
      const { front, body } = splitFrontMatter(text);
      current.front = front;
      if (body === current.original) return;
      const instance = editor.current;
      if (!instance) return;
      instance.setBody(body);
      current.original = body;
      current.canonical = instance.body();
      current.next = current.canonical;
      onExternal(instance);
      showChanges();
    },
    [editor, flush, showChanges, onExternal],
  );

  /** The page's first text, before the editor exists. */
  const start = useCallback((text: string) => {
    if (!sync.current.host) sync.current.host = text;
    const { front, body } = splitFrontMatter(sync.current.host);
    sync.current.front = front;
    return body;
  }, []);
  /** The editor is up with `body`: what it shows is now the baseline for your edits. */
  const started = useCallback((instance: PageEditor, body: string) => {
    sync.current.original = body;
    sync.current.canonical = instance.body();
    sync.current.next = sync.current.canonical;
  }, []);
  /** New suggestions arrived: draw them once the editor is ready. */
  const setSuggestions = useCallback(
    (list: PageSuggestion[], ready: boolean) => {
      shown.current = list;
      if (ready) showChanges();
    },
    [showChanges],
  );

  // Leaving the tab or the window sends what you typed.
  useEffect(() => {
    const leave = () => flush();
    window.addEventListener('pagehide', leave);
    window.addEventListener('blur', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('blur', leave);
    };
  }, [flush]);

  /** The page's text as the host last had it. */
  const hostText = () => sync.current.host;
  return { flush, changed, external, start, started, setSuggestions, hostText };
}
