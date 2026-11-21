import { type KeyboardEvent, type ReactElement, useEffect, useState } from 'react';
import type { PageEntry } from '../../../../shared/model';
import {
  DEFAULT_OVERVIEW_VIEW,
  PAGES_FILTERS,
  type PagesOverviewView,
} from '../../../../shared/protocol/pages';
import { Icon } from '../../../components/icons';
import { OverflowMenu } from '../../../components/menus';
import { post } from '../shared/page-bridge';
import { NewPageDialog } from './new-page-dialog';
import { editedAgo, filterCounts, overviewPages } from './overview-pages';
import { pageActions, RenameField, TrashRow } from './page-rows';
import { type SearchResult, usePageList } from './use-page-list';

const FILTER_LABELS: Record<PagesOverviewView['filter'], string> = {
  all: 'All',
  pinned: 'Pinned',
  daily: 'Daily',
  trash: 'Trash',
};
const EMPTY: Record<PagesOverviewView['filter'], string> = {
  all: 'No pages yet. Start one for a plan, notes, or today’s tasks.',
  pinned: 'Nothing pinned. Pin a page from its ⋯ menu to keep it at hand.',
  daily: 'No daily pages yet. Today’s page starts the first one.',
  trash: 'The trash is empty.',
};

/**
 * Every page in one place, in an editor tab of its own, as Notion lists a workspace's pages:
 * search, filter and sort, then open, rename, pin, duplicate or trash. The sort and filter are
 * kept per workspace by the host.
 */
export function PagesOverview(): ReactElement | null {
  const { state, error, setError, query, setQuery, results } = usePageList();
  const [renaming, setRenaming] = useState<string>();
  const [creating, setCreating] = useState(false);
  /** Shown at once on a change, before the host's copy comes back. */
  const [view, setView] = useState<PagesOverviewView>(DEFAULT_OVERVIEW_VIEW);
  const saved = state?.overview;
  useEffect(() => {
    if (saved) setView(saved);
  }, [saved]);
  // Times read relative to now, so the list refreshes them once a minute.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!state) return null;
  const choose = (next: Partial<PagesOverviewView>) => {
    const merged = { ...view, ...next };
    setView(merged);
    post({ type: 'pagesOverviewView', ...merged });
  };
  const counts = filterCounts(state);
  const searching = Boolean(query.trim());
  const pages = overviewPages(state, view);

  return (
    <div className="pages-overview h-full overflow-y-auto bg-canvas text-foreground">
      <NewPageDialog open={creating} onOpenChange={setCreating} />
      <div className="mx-auto w-full max-w-[920px] px-10 pt-10 pb-24 max-[640px]:px-4 max-[640px]:pt-6">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-[26px] font-semibold tracking-tight">All pages</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] text-accent-foreground hover:bg-accent-hover"
          >
            <Icon name="plus" size={14} />
            New page
          </button>
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-subtle pb-2">
          {searching ? (
            <span className="text-[12.5px] text-muted-foreground">
              {results ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : '…'}
            </span>
          ) : (
            <div role="tablist" aria-label="Show" className="flex flex-wrap items-center gap-0.5">
              {PAGES_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={view.filter === filter}
                  onClick={() => choose({ filter })}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground aria-selected:bg-muted aria-selected:text-foreground"
                >
                  {FILTER_LABELS[filter]}
                  <span className="tabular-nums text-[11px] text-faint">{counts[filter]}</span>
                </button>
              ))}
            </div>
          )}
          <span className="flex-1" />
          <label className="flex h-7 w-[220px] items-center gap-1.5 rounded-md border border-subtle px-2 text-muted-foreground focus-within:border-strong max-[560px]:w-full">
            <Icon name="search" size={13} />
            <input
              type="search"
              value={query}
              placeholder="Search titles and text"
              aria-label="Search pages"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
                if (event.key === 'Enter' && results?.[0])
                  post({ type: 'pageOpen', id: results[0].entry.id });
              }}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-faint"
            />
          </label>
          {!searching ? (
            <label className="flex h-7 items-center gap-1 text-[12.5px] text-muted-foreground">
              <span className="sr-only">Sort by</span>
              <select
                value={view.sort}
                onChange={(event) =>
                  choose({ sort: event.target.value as PagesOverviewView['sort'] })
                }
                className="h-7 rounded-md border border-subtle bg-canvas px-1.5 text-[12.5px] text-foreground"
              >
                <option value="updated">Last edited</option>
                <option value="title">Title</option>
              </select>
            </label>
          ) : null}
        </div>

        {error ? (
          <output className="mt-3 flex items-start gap-2 rounded-md border border-strong bg-surface px-3 py-2 text-[12px]">
            <span className="flex-1">{error}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setError(undefined)}>
              <Icon name="close" size={12} />
            </button>
          </output>
        ) : null}

        {searching ? (
          <PageList
            pages={(results ?? []).map((result) => result.entry)}
            excerpts={results}
            now={now}
            renaming={renaming}
            setRenaming={setRenaming}
            empty={results ? `Nothing matches “${query.trim()}”.` : ''}
          />
        ) : view.filter === 'trash' ? (
          pages.length ? (
            <ul aria-label="Trash" className="mt-2">
              {pages.map((page) => (
                <TrashRow key={page.id} page={page} />
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-[13px] text-muted-foreground">{EMPTY.trash}</p>
          )
        ) : (
          <PageList
            pages={pages}
            now={now}
            renaming={renaming}
            setRenaming={setRenaming}
            empty={EMPTY[view.filter]}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The list itself. Arrow keys move between pages, Enter opens one, F2 renames it and Delete
 * moves it to the trash.
 */
function PageList({
  pages,
  excerpts,
  now,
  renaming,
  setRenaming,
  empty,
}: {
  pages: PageEntry[];
  excerpts?: SearchResult[];
  now: number;
  renaming?: string;
  setRenaming: (id: string | undefined) => void;
  empty: string;
}) {
  if (!pages.length)
    return empty ? (
      <p className="py-10 text-center text-[13px] text-muted-foreground">{empty}</p>
    ) : null;
  const excerptOf = new Map((excerpts ?? []).map((result) => [result.entry.id, result.excerpt]));
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row]'));
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    event.preventDefault();
  };
  return (
    <ul aria-label="Pages" className="mt-1" onKeyDown={move}>
      {pages.map((page) => (
        <li
          key={page.id}
          className="group relative flex items-center gap-3 border-b border-subtle/60 hover:bg-muted/60 focus-within:bg-muted/60"
        >
          {renaming === page.id ? (
            <div className="flex flex-1 items-center gap-3 py-1.5 pl-2">
              <span className="w-5 shrink-0 text-center text-[16px]" aria-hidden="true">
                {page.icon ?? <Icon name="page" size={15} />}
              </span>
              <RenameField page={page} onDone={() => setRenaming(undefined)} className="flex-1" />
            </div>
          ) : (
            <button
              type="button"
              data-row
              onClick={() => post({ type: 'pageOpen', id: page.id })}
              onKeyDown={(event) => {
                if (event.key === 'F2') setRenaming(page.id);
                if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey))
                  post({ type: 'pageTrash', id: page.id });
              }}
              className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-10 pl-2 text-left outline-none"
            >
              <span className="w-5 shrink-0 text-center text-[16px]" aria-hidden="true">
                {page.icon ?? <Icon name="page" size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{page.title}</span>
                {excerptOf.get(page.id) ? (
                  <span className="block truncate text-[12px] text-faint">
                    {excerptOf.get(page.id)}
                  </span>
                ) : null}
              </span>
              {page.pinned ? (
                <span className="shrink-0 text-faint" title="Pinned">
                  <Icon name="pin" size={12} />
                </span>
              ) : null}
              {page.by === 'agent' ? (
                <span className="shrink-0 text-[11px] text-faint" title="An agent wrote this page">
                  agent
                </span>
              ) : null}
              <span
                className="w-[68px] shrink-0 text-right tabular-nums text-[12px] text-faint max-[560px]:hidden"
                title={
                  page.openTasks + page.doneTasks
                    ? `${page.doneTasks} of ${page.openTasks + page.doneTasks} tasks done`
                    : undefined
                }
              >
                {page.openTasks + page.doneTasks
                  ? `${page.doneTasks}/${page.openTasks + page.doneTasks}`
                  : ''}
              </span>
              <span className="w-[92px] shrink-0 text-right text-[12px] text-faint max-[460px]:hidden">
                {editedAgo(page.updatedAt, now)}
              </span>
            </button>
          )}
          {renaming !== page.id ? (
            <span className="absolute right-1 hidden group-focus-within:flex group-hover:flex">
              <OverflowMenu items={pageActions(page, () => setRenaming(page.id))} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
