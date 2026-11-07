import assert from 'node:assert/strict';
import test from 'node:test';
import type { Status } from '../../../../../src/shared/model';
import {
  inProfile,
  isNativeRow,
  nativeRows,
  rootVisible,
  selectedPath,
  splitChildren,
  subtreeActive,
  type ThreadNode,
} from '../../../../../src/webview/features/threads/thread-filter';

const node = (id: string, status: Status, parentId?: string): ThreadNode => ({
  id,
  status,
  parentId,
});
function tree(nodes: ThreadNode[]) {
  const children = new Map<string, ThreadNode[]>();
  for (const item of nodes)
    if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  return children;
}

test('finished subagents go behind "earlier"; active and unfinished ones stay', () => {
  const kids = [
    node('run', 'running', 'p'),
    node('wait', 'waiting', 'p'),
    node('fail', 'failed', 'p'),
    node('stop', 'interrupted', 'p'),
    node('done', 'completed', 'p'),
    node('idle', 'idle', 'p'),
  ];
  const { current, earlier } = splitChildren(kids, tree(kids), new Set());
  assert.deepEqual(
    current.map((item) => item.id),
    ['run', 'wait', 'fail', 'stop'],
  );
  assert.deepEqual(
    earlier.map((item) => item.id),
    ['done', 'idle'],
  );
});

test('a finished subagent stays while it is open, or while its own child runs', () => {
  const nodes = [
    node('open', 'completed', 'p'),
    node('middle', 'completed', 'p'),
    node('deep', 'running', 'middle'),
  ];
  const kids = nodes.slice(0, 2);
  const { current, earlier } = splitChildren(kids, tree(nodes), new Set(['open']));
  assert.deepEqual(
    current.map((item) => item.id),
    ['open', 'middle'],
  );
  assert.equal(earlier.length, 0);
});

test('the selected path includes every parent, and survives a cycle', () => {
  const nodes = [node('a', 'idle'), node('b', 'idle', 'a'), node('c', 'idle', 'b')];
  assert.deepEqual([...selectedPath(nodes, 'c')].sort(), ['a', 'b', 'c']);
  assert.equal(selectedPath(nodes).size, 0);
  const cycle = [node('x', 'idle', 'y'), node('y', 'idle', 'x')];
  assert.equal(selectedPath(cycle, 'x').size, 2);
});

test('running only keeps an old parent of a running child, and the open thread', () => {
  const nodes = [
    node('old', 'completed'),
    node('kid', 'running', 'old'),
    node('quiet', 'completed'),
    node('open', 'completed'),
  ];
  const children = tree(nodes);
  assert.ok(subtreeActive(nodes[0], children));
  assert.ok(rootVisible(nodes[0], children, new Set()));
  assert.ok(!rootVisible(nodes[2], children, new Set()));
  assert.ok(rootVisible(nodes[3], children, new Set(['open'])));
});

test('a tab holds one account’s threads; All holds every account’s', () => {
  assert.equal(inProfile({ provider: 'claude' }, 'claude'), true);
  assert.equal(inProfile({ provider: 'claude', profileId: 'claud2' }, 'claude'), false);
  assert.equal(inProfile({ provider: 'claude', profileId: 'claud2' }, 'claud2'), true);
  assert.equal(inProfile({ provider: 'codex' }, undefined), true);
});

test('terminal sessions follow the tab and search, belong to known accounts, and are not "running"', () => {
  const entries = [
    { profileId: 'codex', sessionId: 'a', title: 'Fix the flaky test', updatedAt: 2 },
    { profileId: 'claud2', sessionId: 'b', title: 'Sketch the parser', updatedAt: 1 },
    { profileId: 'removed', sessionId: 'c', title: 'Gone account', updatedAt: 3 },
  ];
  const base = { needle: '', runningOnly: false, profiles: ['claude', 'claud2', 'codex'] };
  assert.deepEqual(
    nativeRows(entries, base).map((entry) => entry.sessionId),
    ['a', 'b'],
  );
  assert.deepEqual(
    nativeRows(entries, { ...base, profile: 'codex' }).map((entry) => entry.sessionId),
    ['a'],
  );
  assert.deepEqual(
    nativeRows(entries, { ...base, needle: 'parser' }).map((entry) => entry.sessionId),
    ['b'],
  );
  assert.deepEqual(nativeRows(entries, { ...base, runningOnly: true }), []);
  assert.equal(isNativeRow(entries[0]), true);
});
