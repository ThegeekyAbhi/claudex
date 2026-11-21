import type { PageEntry } from '../../../../shared/model';
import type { PagesListState, PagesOverviewView } from '../../../../shared/protocol/pages';

/** The pages the All pages view shows for a filter, in the chosen order. */
export function overviewPages(state: PagesListState, view: PagesOverviewView): PageEntry[] {
  let pages = state.pages;
  switch (view.filter) {
    case 'trash':
      pages = state.trash;
      break;
    case 'pinned':
      pages = pages.filter((page) => page.pinned);
      break;
    case 'daily':
      pages = pages.filter((page) => page.day);
      break;
  }
  return [...pages].sort((a, b) => {
    if (view.sort === 'title') {
      const order = a.title.localeCompare(b.title, undefined, {
        sensitivity: 'base',
        numeric: true,
      });
      if (order) return order;
    }
    return b.updatedAt - a.updatedAt;
  });
}

/** How many pages each filter would show. */
export function filterCounts(state: PagesListState): Record<PagesOverviewView['filter'], number> {
  let pinned = 0;
  let daily = 0;
  for (const page of state.pages) {
    if (page.pinned) pinned++;
    if (page.day) daily++;
  }
  return { all: state.pages.length, pinned, daily, trash: state.trash.length };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a page last changed, the way a list reads it: `Just now`, `5 min ago`, `Yesterday`. */
export function editedAgo(time: number, now: number): string {
  const ago = Math.max(0, now - time);
  if (ago < MINUTE) return 'Just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  const then = new Date(time);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (time >= midnight) return `${Math.floor(ago / HOUR)} h ago`;
  if (time >= midnight - DAY) return 'Yesterday';
  const date = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === today.getFullYear() ? date : `${date} ${then.getFullYear()}`;
}
