import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dailyDay,
  dailyId,
  dailyTemplate,
  dayTitle,
} from '../../../../src/shared/domain/pages/daily';
import { PAGE_ID, pageEntry, pageForAgent } from '../../../../src/shared/domain/pages/entry';

test('page ids are slugs or a day under daily/', () => {
  for (const id of ['release-plan-3f9a1c', 'daily/2026-11-21']) assert.match(id, PAGE_ID);
  for (const id of ['../x', 'Daily/2026-11-21', '-x', 'a/b', '']) assert.doesNotMatch(id, PAGE_ID);
});

test('daily pages are named after their day in every locale', () => {
  assert.equal(dailyId('2026-11-21'), 'daily/2026-11-21');
  assert.equal(dailyDay('daily/2026-11-21'), '2026-11-21');
  assert.equal(dailyDay('notes-1'), undefined);
  assert.equal(dayTitle('2026-11-21'), 'Saturday, 21 November');
  assert.match(dailyTemplate('2026-11-21'), /^---\nicon: 📅\n---\n\n# Saturday, 21 November\n/);
});

test('an entry summarises a page for the list', () => {
  const text = '---\nicon: 🚀\npinned: true\n---\n\n# Launch\n\n- [ ] a\n- [x] b\n- [x] c\n';
  assert.deepEqual(pageEntry('daily/2026-11-21', text, 5), {
    id: 'daily/2026-11-21',
    title: 'Launch',
    icon: '🚀',
    pinned: true,
    day: '2026-11-21',
    updatedAt: 5,
    openTasks: 1,
    doneTasks: 2,
  });
});

test('an agent reads the page without its front matter', () => {
  const text = '---\nicon: 🚀\n---\n\n# Launch\n';
  const entry = pageEntry('launch-1', text, 0);
  assert.equal(pageForAgent(entry, text), 'Page “Launch” (id: launch-1)\n\n# Launch');
  assert.equal(pageForAgent(entry, ''), 'Page “Launch” (id: launch-1)\n\n(empty)');
});
