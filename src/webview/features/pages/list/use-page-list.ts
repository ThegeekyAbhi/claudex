import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageEntry } from '../../../../shared/model';
import type { PagesHostMessage, PagesListState } from '../../../../shared/protocol/pages';
import { post, useHostMessages } from '../shared/page-bridge';

export type SearchResult = { entry: PageEntry; excerpt?: string };

/**
 * Your pages as the host lists them, and a search over their titles and text. The side bar and
 * the All pages view both read from here, so they show the same thing.
 */
export function usePageList() {
  const [state, setState] = useState<PagesListState>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>();
  /** Only answers to the latest query are shown. */
  const latestQuery = useRef('');
  const receive = useCallback((message: PagesHostMessage) => {
    if (message.type === 'pages') setState(message.state);
    if (message.type === 'error') setError(message.text);
    if (message.type === 'pageSearchResults')
      setResults((current) => (message.query === latestQuery.current ? message.results : current));
  }, []);
  useHostMessages(receive);
  useEffect(() => {
    const trimmed = query.trim();
    latestQuery.current = trimmed;
    if (!trimmed) {
      setResults(undefined);
      return;
    }
    const timer = window.setTimeout(() => post({ type: 'pageSearch', query: trimmed }), 120);
    return () => window.clearTimeout(timer);
  }, [query]);
  return { state, error, setError, query, setQuery, results };
}
