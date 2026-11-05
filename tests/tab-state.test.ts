import assert from 'node:assert/strict';
import test from 'node:test';
import type { Status } from '../src/core/model';
import {
  isDraftTab,
  isUnread,
  needsYou,
  pruneSeen,
  reconcileTabs,
  tabAfterClosing,
  threadSignal,
} from '../src/webview/features/threads/tab-state';

const node = (id: string, status: Status, updatedAt = 10, parentId?: string) => ({
  id,
  status,
  updatedAt,
  parentId,
});

test('tabs keep their order, gain the open thread, and lose deleted threads', () => {
  const known = new Set(['a', 'b', 'c']);
  assert.deepEqual(reconcileTabs(['b', 'a'], 'c', known), ['b', 'a', 'c']);
  assert.deepEqual(reconcileTabs(['b', 'gone'], 'b', known), ['b']);
  assert.deepEqual(reconcileTabs(['b'], undefined, known), ['b']);
  assert.deepEqual(reconcileTabs([], 'gone', known), []);
});

test('closing a tab moves to its right neighbour, then its left', () => {
  assert.equal(tabAfterClosing(['a', 'b', 'c'], 'a'), 'b');
  assert.equal(tabAfterClosing(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(tabAfterClosing(['a', 'b', 'c'], 'c'), 'b');
  assert.equal(tabAfterClosing(['a'], 'a'), undefined);
});

test('a thread is unread only if it finished after you opened it', () => {
  assert.ok(isUnread(node('a', 'completed', 20), { a: 10 }));
  assert.ok(!isUnread(node('a', 'completed', 10), { a: 10 }));
  assert.ok(!isUnread(node('a', 'completed', 20), {}), 'old history never lights up');
  assert.ok(!isUnread(node('a', 'failed', 20), { a: 10 }), 'a failure has its own signal');
  assert.ok(!isUnread(node('a', 'interrupted', 20), { a: 10 }), 'interrupted is not finished');
});

test('needing you outranks everything, including from a subagent', () => {
  const none = new Map();
  const signal = (status: Status) => threadSignal(node('a', status, 20), none, { a: 10 });
  assert.equal(signal('waiting'), 'waiting');
  assert.equal(signal('failed'), 'failed');
  assert.equal(signal('running'), 'running');
  assert.equal(signal('completed'), 'unread');
  assert.equal(signal('idle'), undefined);
  assert.equal(signal('interrupted'), undefined);
  const parent = node('p', 'running');
  const middle = node('m', 'running', 10, 'p');
  const deep = node('d', 'waiting', 10, 'm');
  const children = new Map([
    ['p', [middle]],
    ['m', [deep]],
  ]);
  assert.equal(threadSignal(parent, children, {}), 'waiting');
});

test('seen times are dropped with their threads', () => {
  assert.deepEqual(pruneSeen({ a: 1, b: 2 }, new Set(['a'])), { a: 1 });
});

test('drafts keep their tabs, and a started draft hands its place to its thread', () => {
  const known = new Set(['a']);
  const draft = '__compose:1';
  assert.ok(isDraftTab('__compose') && isDraftTab(draft) && !isDraftTab('a'));
  assert.deepEqual(reconcileTabs(['a', draft], undefined, known), ['a', draft]);
  assert.deepEqual(reconcileTabs(['a'], draft, known), ['a', draft]);
  assert.deepEqual(reconcileTabs([draft, 'a'], 'new', new Set(['a', 'new']), draft), ['new', 'a']);
  assert.deepEqual(reconcileTabs([draft, 'a'], 'new', new Set(['a', 'new'])), [draft, 'a', 'new']);
});

test('only waiting, or a failure you have not seen, rises to Needs you', () => {
  const none = new Map();
  assert.ok(needsYou(node('a', 'waiting'), none, {}));
  assert.ok(needsYou(node('a', 'failed', 20), none, { a: 10 }));
  assert.ok(!needsYou(node('a', 'failed', 10), none, { a: 10 }), 'a failure you have seen settles');
  assert.ok(!needsYou(node('a', 'failed', 20), none, {}), 'old history stays put');
  assert.ok(!needsYou(node('a', 'running'), none, {}));
  assert.ok(!needsYou(node('a', 'completed', 20), none, { a: 10 }));
});
