import assert from 'node:assert/strict';
import test from 'node:test';
import type { PageEntry } from '../../../../src/shared/model';
import { DEFAULT_OVERVIEW_VIEW, type PagesListState } from '../../../../src/shared/protocol/pages';
import {
  editedAgo,
  filterCounts,
  overviewPages,
} from '../../../../src/webview/features/pages/list/overview-pages';

const page = (id: string, title: string, updatedAt: number, extra: Partial<PageEntry> = {}) => ({
  id,
  title,
  updatedAt,
  openTasks: 0,
  doneTasks: 0,
  ...extra,
});
const state: PagesListState = {
  today: '2026-11-21',
  todayId: 'daily/2026-11-21',
  pages: [
    page('beta-1', 'beta', 30),
    page('alpha-1', 'Alpha', 10, { pinned: true }),
    page('daily/2026-11-21', 'Saturday, 21 November', 20, { day: '2026-11-21' }),
    page('page-10', 'Page 10', 5),
    page('page-9', 'Page 9', 5),
  ],
  recents: [],
  trash: [page('old-1', 'Old', 1)],
  overview: DEFAULT_OVERVIEW_VIEW,
};
const ids = (pages: PageEntry[]) => pages.map((item) => item.id);

test('the newest change comes first by default', () => {
  assert.deepEqual(ids(overviewPages(state, { sort: 'updated', filter: 'all' })).slice(0, 3), [
    'beta-1',
    'daily/2026-11-21',
    'alpha-1',
  ]);
});

test('titles sort ignoring case and with numbers in order', () => {
  assert.deepEqual(ids(overviewPages(state, { sort: 'title', filter: 'all' })), [
    'alpha-1',
    'beta-1',
    'page-9',
    'page-10',
    'daily/2026-11-21',
  ]);
});

test('filters show pinned, daily or trashed pages, and count each', () => {
  assert.deepEqual(ids(overviewPages(state, { sort: 'updated', filter: 'pinned' })), ['alpha-1']);
  assert.deepEqual(ids(overviewPages(state, { sort: 'updated', filter: 'daily' })), [
    'daily/2026-11-21',
  ]);
  assert.deepEqual(ids(overviewPages(state, { sort: 'updated', filter: 'trash' })), ['old-1']);
  assert.deepEqual(filterCounts(state), { all: 5, pinned: 1, daily: 1, trash: 1 });
  // The list it was given is left as it was.
  assert.equal(state.pages[0].id, 'beta-1');
});

test('edit times read like a list would say them', () => {
  const now = new Date(2026, 10, 21, 15, 0).getTime();
  assert.equal(editedAgo(now - 20_000, now), 'Just now');
  assert.equal(editedAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(editedAgo(new Date(2026, 10, 21, 9, 0).getTime(), now), '6 h ago');
  assert.equal(editedAgo(new Date(2026, 10, 20, 23, 0).getTime(), now), 'Yesterday');
  assert.equal(editedAgo(new Date(2026, 10, 3, 12, 0).getTime(), now), '3 Nov');
  assert.equal(editedAgo(new Date(2025, 0, 9, 12, 0).getTime(), now), '9 Jan 2025');
  assert.equal(editedAgo(now + 5_000, now), 'Just now');
});
