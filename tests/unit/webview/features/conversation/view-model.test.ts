import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileDiff, Message, Session, ToolInfo } from '../../../../../src/shared/model';
import {
  activitySummary,
  diffsOf,
  duration,
  findChild,
  segment,
  segmentHas,
  segmentKey,
  verb,
} from '../../../../../src/webview/features/conversation/view-model';

function message(id: string, role: Message['role'], tool?: Partial<ToolInfo>): Message {
  return {
    id,
    role,
    text: id,
    ...(tool
      ? { tool: { kind: 'command', name: 'shell', title: id, status: 'completed', ...tool } }
      : {}),
  };
}
function session(id: string, parentId?: string, nativeId?: string): Session {
  return {
    id,
    parentId,
    nativeId,
    provider: 'codex',
    title: id,
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test('conversation grouping preserves message order and excludes filesystem observations', () => {
  const messages = [
    message('user', 'user'),
    message('thinking', 'thinking'),
    message('command', 'tool', {}),
    message('observed', 'tool', { diffSource: 'filesystem' }),
    message('legacy', 'tool'),
    message('worker', 'tool', { kind: 'agent', name: 'delegate' }),
    message('answer', 'assistant'),
    message('after', 'tool', {}),
  ];
  const rows = segment(messages);
  assert.deepEqual(rows, [
    { type: 'message', message: messages[0] },
    { type: 'activity', items: [messages[1], messages[2], messages[4]] },
    { type: 'subagent', message: messages[5] },
    { type: 'message', message: messages[6] },
    { type: 'activity', items: [messages[7]] },
  ]);
  assert.equal(messages.length, 8);
  assert.equal(segmentKey(rows[1]), 'thinking');
  assert.equal(segmentKey(rows[2]), 'worker');
  assert.equal(segmentHas(rows[1], 'legacy'), true);
  assert.equal(segmentHas(rows[1], 'observed'), false);
  assert.equal(segmentHas(rows[2], 'worker'), true);
  assert.equal(segmentHas(rows[0], undefined), false);
  assert.equal(segmentHas(rows[0], 'answer'), false);
});

test('only known agent tools receive worker cards', () => {
  for (const name of ['delegate', 'run_agent', 'spawnAgent', 'Task', 'Agent']) {
    assert.equal(segment([message(name, 'tool', { kind: 'agent', name })])[0].type, 'subagent');
  }
  assert.equal(
    segment([message('unknown', 'tool', { kind: 'agent', name: 'other' })])[0].type,
    'activity',
  );
  assert.equal(segment([message('command', 'tool', { name: 'Task' })])[0].type, 'activity');
  assert.deepEqual(segment([]), []);
});

test('worker lookup requires the parent and matches local or native worker IDs', () => {
  const parent = session('parent');
  const local = session('local', parent.id);
  const native = session('other-local', parent.id, 'native');
  const unrelated = session('native', 'another-parent');
  const sessions = [unrelated, local, native];
  assert.equal(
    findChild(message('fallback', 'tool', { workerId: 'local' }), parent, sessions),
    local,
  );
  assert.equal(
    findChild(message('fallback', 'tool', { workerId: 'native' }), parent, sessions),
    native,
  );
  assert.equal(findChild(message('local', 'tool'), parent, sessions), local);
  assert.equal(findChild(message('missing', 'tool'), parent, sessions), undefined);
});

test('activity summaries keep the established ordering, plurals, and legacy rows', () => {
  assert.equal(activitySummary([message('reasoning', 'thinking')]), 'Thought it through');
  assert.equal(
    activitySummary([
      message('search1', 'tool', { kind: 'search' }),
      message('read', 'tool', { kind: 'read' }),
      message('edit', 'tool', { kind: 'edit' }),
      message('command', 'tool', {}),
      message('search2', 'tool', { kind: 'search' }),
      message('web', 'tool', { kind: 'web' }),
      message('skill', 'tool', { kind: 'skill' }),
      message('other', 'tool', { kind: 'other' }),
      message('legacy', 'tool'),
      message('observed', 'tool', { kind: 'edit', diffSource: 'filesystem' }),
    ]),
    'Edited 1 file, ran 1 command, read 1 file, ran 2 searches, fetched 1 page, invoked 1 skill, used 1 tool, ran 1 step',
  );
});

test('failed, declined, and interrupted tools never contribute diffs', () => {
  const diff: FileDiff = { path: 'file.ts', kind: 'update', patch: '', additions: 2, deletions: 1 };
  const messages = (['completed', 'running', 'failed', 'declined', 'interrupted'] as const).map(
    (status) => message(status, 'tool', { status, diffs: [diff] }),
  );
  assert.deepEqual(diffsOf(messages), [diff, diff]);
  assert.deepEqual(diffsOf([message('legacy', 'tool')]), []);
});

test('tool verbs preserve explicit unsuccessful and interrupted states', () => {
  const tool: ToolInfo = { kind: 'command', name: 'shell', title: 'test', status: 'running' };
  assert.equal(verb(tool), 'Running');
  assert.equal(verb({ ...tool, status: 'completed' }), 'Ran');
  assert.equal(verb({ ...tool, status: 'failed' }), 'Failed: running');
  assert.equal(verb({ ...tool, status: 'declined' }), 'Declined: running');
  assert.equal(verb({ ...tool, status: 'interrupted' }), 'Interrupted:');
  assert.equal(
    verb({ ...tool, kind: 'skill', skill: { name: 'review', phase: 'read' } }),
    'Reading skill',
  );
  assert.equal(
    verb({ ...tool, kind: 'skill', status: 'completed', skill: { name: 'review', phase: 'read' } }),
    'Read skill',
  );
});

test('duration labels retain millisecond and minute rounding', () => {
  for (const [value, label] of [
    [0, '1ms'],
    [10.6, '11ms'],
    [999, '999ms'],
    [1000, '1s'],
    [1499, '1s'],
    [1500, '2s'],
    [59500, '1m 0s'],
    [61000, '1m 1s'],
  ] as const) {
    assert.equal(duration(value), label);
  }
});
