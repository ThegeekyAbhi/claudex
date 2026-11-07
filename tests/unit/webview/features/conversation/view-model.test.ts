import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileDiff, Message, Session, ToolInfo } from '../../../../../src/shared/model';
import {
  activitySummary,
  diffsOf,
  duration,
  findChild,
  isPlanEdit,
  noteIndices,
  segment,
  segmentHas,
  segmentKey,
  turns,
  verb,
  workDuration,
  workMessages,
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

const say = (id: string, role: 'user' | 'assistant' | 'notice', at?: number): Message => ({
  id,
  role,
  text: id,
  ...(at !== undefined ? { startedAt: at } : {}),
});
const step = (id: string, at?: number): Message => ({
  id,
  role: 'tool',
  text: '',
  ...(at !== undefined ? { startedAt: at } : {}),
  tool: { kind: 'command', name: 'command', title: id, status: 'completed' },
});
const delegate = (id: string): Message => ({
  id,
  role: 'tool',
  text: '',
  tool: { kind: 'agent', name: 'delegate', title: id, status: 'completed' },
});
const view = (messages: Message[], live = false) => {
  const segments = segment(messages);
  return { segments, turns: turns(segments, live), notes: noteIndices(segments) };
};

test('folds a finished turn’s notes and steps, keeping your message and the answer', () => {
  const {
    segments,
    turns: [turn],
    notes,
  } = view([
    say('q', 'user', 0),
    say('n1', 'assistant', 1_000),
    step('s1', 2_000),
    say('n2', 'assistant', 3_000),
    step('s2', 4_000),
    say('a', 'assistant', 64_000),
  ]);
  assert.equal(turn.fold, true);
  assert.equal(turn.answer, 5);
  assert.deepEqual(turn.work, [1, 2, 3, 4]);
  assert.deepEqual([...notes], [3, 1]);
  const rows = workMessages(segments, turn.work);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['n1', 's1', 'n2', 's2'],
  );
  assert.equal(workDuration(rows, say('a', 'assistant', 64_000)), 63_000);
});

test('never folds the turn still running, or one with no answer or little work', () => {
  const running = view(
    [say('q', 'user'), say('n', 'assistant'), step('s'), say('a', 'assistant')],
    true,
  );
  assert.equal(running.turns[0].fold, false);
  const unanswered = view([say('q', 'user'), say('n', 'assistant'), step('s')]);
  assert.equal(unanswered.turns[0].fold, false);
  assert.equal(unanswered.turns[0].answer, undefined);
  // One group of steps already reads as one line.
  const small = view([say('q', 'user'), step('s'), say('a', 'assistant')]);
  assert.equal(small.turns[0].fold, false);
});

test('splits at each of your messages; only the last turn is live', () => {
  const { turns: all } = view(
    [
      say('q1', 'user'),
      say('n', 'assistant'),
      step('s'),
      say('a1', 'assistant'),
      say('q2', 'user'),
      say('n2', 'assistant'),
      step('s2'),
      say('a2', 'assistant'),
    ],
    true,
  );
  assert.deepEqual(
    all.map((turn) => [turn.start, turn.end, turn.fold]),
    [
      [0, 4, true],
      [4, 8, false],
    ],
  );
});

test('keeps subagents and notices out of the fold, in view', () => {
  const {
    turns: [turn],
  } = view([
    say('q', 'user'),
    say('n', 'assistant'),
    delegate('d'),
    step('s'),
    say('From the terminal', 'notice'),
    say('a', 'assistant'),
  ]);
  assert.equal(turn.fold, true);
  // 2 is the subagent card, 4 the notice: neither is folded work.
  assert.deepEqual(turn.work, [1, 3]);
});

test('a window that starts mid-turn, after older messages were left out, still groups', () => {
  const { turns: all } = view([
    say('n', 'assistant'),
    step('s'),
    say('a', 'assistant'),
    say('q', 'user'),
  ]);
  assert.deepEqual(
    all.map((turn) => [turn.start, turn.work, turn.fold]),
    [
      [0, [0, 1], true],
      [3, [], false],
    ],
  );
});

test('a duration is given only from times the CLI recorded', () => {
  assert.equal(workDuration([step('s')], say('a', 'assistant')), undefined);
});

test('edits to Claude Code’s plan file read as the plan, not as a diff', () => {
  const planEdit: Message = {
    id: 'p',
    role: 'tool',
    text: '',
    tool: {
      kind: 'edit',
      name: 'Write',
      title: '/Users/me/.claude-account2/plans/demo.md',
      status: 'completed',
      diffs: [
        {
          path: '/Users/me/.claude-account2/plans/demo.md',
          kind: 'update',
          patch: '@@ -1 +1 @@\n-# Old\n+# New',
          additions: 1,
          deletions: 1,
        },
      ],
    },
  };
  const realEdit: Message = {
    id: 'e',
    role: 'tool',
    text: '',
    tool: {
      kind: 'edit',
      name: 'Edit',
      title: 'src/app.ts',
      status: 'completed',
      diffs: [{ path: 'src/app.ts', kind: 'update', patch: '', additions: 1, deletions: 0 }],
    },
  };
  assert.deepEqual(diffsOf([planEdit]), []);
  assert.equal(diffsOf([planEdit, realEdit]).length, 1);
  assert.equal(isPlanEdit(planEdit.tool), true);
  assert.equal(isPlanEdit(realEdit.tool), false);
  assert.equal(verb(planEdit.tool as ToolInfo), 'Updated');
  assert.equal(activitySummary([planEdit, realEdit]), 'Wrote the plan, edited 1 file');
});
