import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PageHostMessage, PageViewState } from '../../../../../shared/protocol/pages';
import type { MentionState, PageEditor } from '../../editor/types';
import { post } from '../../shared/page-bridge';
import { nextRequest } from '../../shared/requests';
import { mentionItems } from './mention-items';

/**
 * The `@` menu: what you're typing after `@`, the workspace files the host finds for it, and
 * the keyboard while the menu is open.
 */
export function useMentions(
  state: PageViewState | undefined,
  editor: RefObject<PageEditor | undefined>,
) {
  const [mention, setMention] = useState<MentionState>();
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]);
  const fileQuery = useRef('');

  /** The editor reports the mention as you type; an unchanged one keeps its identity. */
  const track = useCallback((next: MentionState | undefined) => {
    setMention((previous) =>
      previous?.query === next?.query && previous?.from === next?.from ? previous : next,
    );
  }, []);
  /** Files found for the latest query; older answers are dropped. */
  const receive = useCallback((message: PageHostMessage) => {
    if (message.type === 'pageFileResults' && message.requestId === fileQuery.current)
      setFiles(message.matches);
  }, []);

  // Files for the `@` menu come from the host as you type.
  const query = mention?.query;
  const trusted = Boolean(state?.trusted);
  useEffect(() => {
    if (query === undefined || !trusted) {
      setFiles([]);
      return;
    }
    const timer = window.setTimeout(() => {
      const requestId = nextRequest();
      fileQuery.current = requestId;
      post({ type: 'pageSearchFiles', requestId, query });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [query, trusted]);

  const groups = useMemo(
    () => (mention ? mentionItems(state, mention.query, files) : []),
    [state, mention, files],
  );
  const flat = groups.flatMap((group) => group.items);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the top
  useEffect(() => setIndex(0), [mention?.query, mention?.from]);
  const open = Boolean(mention && flat.length);

  /** Arrow keys move, Enter and Tab pick, Escape closes; other keys go to the page. */
  const keyRef = useRef<(key: string) => boolean>(() => false);
  keyRef.current = (key) => {
    if (!open || !mention || !editor.current) return false;
    if (key === 'ArrowDown') setIndex((value) => (value + 1) % flat.length);
    else if (key === 'ArrowUp') setIndex((value) => (value - 1 + flat.length) % flat.length);
    else if (key === 'Enter' || key === 'Tab') flat[index]?.run(editor.current, mention);
    else if (key === 'Escape') setMention(undefined);
    else return false;
    return true;
  };
  const key = useCallback((pressed: string) => keyRef.current(pressed), []);

  return { mention, track, receive, key, open, groups, flat, index, setIndex };
}
