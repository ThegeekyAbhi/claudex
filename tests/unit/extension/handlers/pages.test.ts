import assert from 'node:assert/strict';
import test from 'node:test';
import { PagesHandlers } from '../../../../src/extension/handlers/pages';
import type { Surface } from '../../../../src/extension/surfaces';
import { actionSchema } from '../../../../src/shared/model';

test('the chat menu opens today’s page and the page picker', async () => {
  const calls: string[] = [];
  const handlers = new PagesHandlers({
    open: async (id) => void calls.push(`open:${id}`),
    openToday: async () => void calls.push('today'),
    browse: async () => void calls.push('browse'),
  }).handlers();
  const surface = {} as Surface;
  await handlers.openTodayPage({ type: 'openTodayPage' }, surface);
  await handlers.browsePages({ type: 'browsePages' }, surface);
  await handlers.pageOpen({ type: 'pageOpen', id: 'daily/2026-11-21' }, surface);
  assert.deepEqual(calls, ['today', 'browse', 'open:daily/2026-11-21']);
});

test('page actions from the chat are validated', () => {
  assert.ok(actionSchema.safeParse({ type: 'openTodayPage' }).success);
  assert.ok(actionSchema.safeParse({ type: 'browsePages' }).success);
  assert.equal(actionSchema.safeParse({ type: 'pageOpen', id: '../secrets' }).success, false);
});
