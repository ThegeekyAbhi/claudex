import { type ReactElement, useState } from 'react';
import type { PageViewState } from '../../../../shared/protocol/pages';

interface PageChooserProps {
  state: PageViewState;
  onPick: (page: { id: string; title: string }) => void;
  onClose: () => void;
}

/** The `/page` chooser: links another of your pages here. */
export function PageChooser({ state, onPick, onClose }: PageChooserProps): ReactElement {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const needle = query.toLowerCase();
  const pages = state.pages
    .filter((page) => page.id !== state.id && page.title.toLowerCase().includes(needle))
    .slice(0, 12);
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
      />
      <div
        role="dialog"
        aria-label="Link to a page"
        className="relative mx-auto mt-[18vh] w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-strong bg-overlay p-1.5 shadow-md"
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: the chooser was just opened to type in
          autoFocus
          value={query}
          placeholder="Link to a page…"
          aria-label="Find a page"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown')
              setIndex((value) => Math.min(value + 1, pages.length - 1));
            if (event.key === 'ArrowUp') setIndex((value) => Math.max(value - 1, 0));
            if (event.key === 'Enter' && pages[index]) onPick(pages[index]);
          }}
          className="w-full rounded-lg bg-transparent px-2.5 py-2 text-[13px] outline-none"
        />
        <div className="max-h-[300px] overflow-y-auto">
          {pages.map((page, at) => (
            <button
              key={page.id}
              type="button"
              data-active={at === index}
              onMouseEnter={() => setIndex(at)}
              onClick={() => onPick(page)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] data-[active=true]:bg-muted"
            >
              <span className="w-4 text-center">{page.icon ?? '📄'}</span>
              <span className="truncate">{page.title}</span>
            </button>
          ))}
          {!pages.length ? (
            <div className="px-2.5 py-2 text-[12px] text-muted-foreground">
              No page by that name.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
