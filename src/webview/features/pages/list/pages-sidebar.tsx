import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import type { PageEntry } from '../../../../shared/model';
import { Icon } from '../../../components/icons';
import { Hint } from '../../../components/menus';
import { post } from '../shared/page-bridge';
import { NewPageDialog } from './new-page-dialog';
import { Empty, Fold, PageRow, Section, TodayRow, TrashRow } from './page-rows';
import { usePageList } from './use-page-list';

/** The Pages side bar: today's page, what you pinned and opened lately, and everything else. */
export function PagesApp(): ReactElement | null {
  const { state, error, setError, query, setQuery, results } = usePageList();
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);

  if (!state) return null;
  const byId = new Map(state.pages.map((page) => [page.id, page]));
  const today = byId.get(state.todayId);
  const pinned = state.pages.filter((page) => page.pinned);
  const shown = new Set([state.todayId, ...pinned.map((page) => page.id)]);
  const recent = state.recents
    .map((id) => byId.get(id))
    .filter((page): page is PageEntry => page !== undefined && !shown.has(page.id))
    .slice(0, 6);
  const others = state.pages.filter((page) => !page.day);
  const daily = state.pages.filter((page) => page.day && page.id !== state.todayId);
  const row = (page: PageEntry, detail?: ReactNode) => (
    <PageRow
      key={page.id}
      page={page}
      active={page.id === state.activeId}
      renaming={renaming === page.id}
      onRename={(value) => setRenaming(value ? page.id : undefined)}
      detail={detail}
    />
  );

  return (
    <div className="pages-app flex h-full flex-col text-[13px] text-foreground">
      <NewPageDialog open={creating} onOpenChange={setCreating} />
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex h-7 flex-1 items-center gap-2 rounded-md px-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Icon name="plus" size={14} />
          New page
        </button>
        <Hint label="All pages">
          <button
            type="button"
            aria-label="All pages"
            onClick={() => post({ type: 'pagesOverview' })}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon name="list" size={14} />
          </button>
        </Hint>
        <Hint label="Search pages">
          <button
            type="button"
            aria-label="Search pages"
            aria-pressed={searching}
            onClick={() => {
              setSearching((value) => !value);
              setQuery('');
            }}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            <Icon name="search" size={14} />
          </button>
        </Hint>
      </div>
      {searching ? (
        <div className="px-2 pb-1">
          <input
            ref={search}
            value={query}
            placeholder="Search titles and text"
            aria-label="Search pages"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearching(false);
                setQuery('');
              }
              if (event.key === 'Enter' && results?.[0])
                post({ type: 'pageOpen', id: results[0].entry.id });
            }}
            className="w-full rounded-md border border-strong bg-transparent px-2 py-1 text-[12.5px] outline-none focus:border-ring"
          />
        </div>
      ) : null}
      {error ? (
        <output className="mx-2 mb-1 flex items-start gap-2 rounded-md border border-strong bg-surface px-2 py-1.5 text-[12px]">
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(undefined)}>
            <Icon name="close" size={12} />
          </button>
        </output>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {results ? (
          <Section title={`${results.length} ${results.length === 1 ? 'result' : 'results'}`}>
            {results.map(({ entry, excerpt }) =>
              row(
                entry,
                excerpt ? (
                  <span className="block truncate text-[11.5px] text-faint">{excerpt}</span>
                ) : undefined,
              ),
            )}
            {!results.length ? (
              <p className="px-2 py-1 text-[12px] text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            ) : null}
          </Section>
        ) : (
          <>
            <TodayRow day={state.today} page={today} active={state.activeId === state.todayId} />
            {pinned.length ? (
              <Section title="Pinned">{pinned.map((page) => row(page))}</Section>
            ) : null}
            {recent.length ? (
              <Section title="Recent">{recent.map((page) => row(page))}</Section>
            ) : null}
            {others.length || daily.length ? (
              <Fold title="All pages" count={others.length} open={!recent.length && !pinned.length}>
                {others.map((page) => row(page))}
                {daily.length ? (
                  <Fold title="Daily" count={daily.length} nested>
                    {daily.map((page) => row(page))}
                  </Fold>
                ) : null}
              </Fold>
            ) : (
              <Empty />
            )}
            {state.trash.length ? (
              <Fold title="Trash" count={state.trash.length}>
                {state.trash.map((page) => (
                  <TrashRow key={page.id} page={page} />
                ))}
              </Fold>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
