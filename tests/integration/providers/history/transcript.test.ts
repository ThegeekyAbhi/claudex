import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeTranscript, codexTranscript } from '../../../../src/providers/history/transcript';
import type { Session } from '../../../../src/shared/model';

function session(provider: 'claude' | 'codex'): Session {
  return {
    id: 'thread',
    provider,
    title: 'Thread',
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
const at = (second: number) => new Date(Date.UTC(2026, 10, 7, 10, 0, second)).toISOString();

test('Claude records become your messages, replies and tool rows, in order', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: at(1), message: { content: 'List the files' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: at(2),
      message: { id: 'm1', content: [{ type: 'text', text: 'Looking.' }] },
    },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: at(3),
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }],
      },
    },
    {
      type: 'user',
      uuid: 'r1',
      timestamp: at(4),
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'a.ts' }] },
    },
    // Left out: a subagent's own step, CLI markup, an injected meta line, and one with no time.
    {
      type: 'assistant',
      uuid: 's1',
      timestamp: at(5),
      parent_tool_use_id: 'task',
      message: { id: 'm2', content: [{ type: 'text', text: 'Subagent' }] },
    },
    {
      type: 'user',
      uuid: 'c1',
      timestamp: at(6),
      message: { content: '<command-name>/clear</command-name>' },
    },
    { type: 'user', uuid: 'meta', isMeta: true, timestamp: at(7), message: { content: 'Caveat' } },
    { type: 'assistant', uuid: 'bad', timestamp: 'never', message: { id: 'm3', content: [] } },
  ];
  const { messages, skipped } = claudeTranscript(session('claude'), records);
  assert.equal(skipped, 1, 'a record with no time is counted, not guessed');
  assert.deepEqual(
    messages.map((item) => [item.role, item.text, item.tool?.status]),
    [
      ['user', 'List the files', undefined],
      ['assistant', 'Looking.', undefined],
      ['tool', 'a.ts', 'completed'],
    ],
  );
  assert.equal(messages[2].id, 'tool-1');
  assert.equal(messages[0].nativeRef, 'u1:0');
  assert.equal(messages[1].startedAt, Date.parse(at(2)));
  // Reading again gives the same ids, so a later read can tell what it already has.
  const again = claudeTranscript(session('claude'), records).messages.map((item) => item.id);
  assert.deepEqual(
    again,
    messages.map((item) => item.id),
  );
});

test('a Claude tool call with no recorded result is interrupted, never completed', () => {
  const { messages } = claudeTranscript(session('claude'), [
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: at(1),
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'make' } }],
      },
    },
  ]);
  assert.equal(messages[0].tool?.status, 'interrupted');
});

test('Codex turns become your messages, replies and command rows; untimed items are counted', () => {
  const turns = [
    {
      startedAt: 1_700_000_000,
      items: [
        { type: 'userMessage', id: 'i1', content: [{ type: 'text', text: 'Run the tests' }] },
        {
          type: 'commandExecution',
          id: 'i2',
          startedAtMs: 1_700_000_001_000,
          command: 'pnpm test',
          status: 'completed',
          exitCode: 1,
          aggregatedOutput: '1 failed',
        },
        { type: 'reasoning', id: 'i3', summary: ['Thinking'] },
        { type: 'agentMessage', id: 'i4', text: 'One test fails.' },
      ],
    },
    { items: [{ type: 'agentMessage', id: 'i5', text: 'No time' }] },
  ];
  const { messages, skipped } = codexTranscript(session('codex'), turns);
  assert.equal(skipped, 1);
  assert.deepEqual(
    messages.map((item) => [item.role, item.text, item.tool?.status]),
    [
      ['user', 'Run the tests', undefined],
      ['tool', '1 failed', 'failed'],
      ['assistant', 'One test fails.', undefined],
    ],
  );
  assert.equal(messages[0].startedAt, 1_700_000_000_000);
  assert.equal(messages[1].startedAt, 1_700_000_001_000);
});

test('a Codex item the CLI never finished is interrupted; declined stays declined', () => {
  const turns = [
    {
      startedAt: 1_700_000_000,
      items: [
        { type: 'commandExecution', id: 'c1', command: 'make', status: 'inProgress' },
        { type: 'commandExecution', id: 'c2', command: 'rm -rf build', status: 'declined' },
        { type: 'fileChange', id: 'c3', changes: [], status: 'inProgress' },
      ],
    },
  ];
  const { messages } = codexTranscript(session('codex'), turns);
  assert.deepEqual(
    messages.map((item) => item.tool?.status),
    ['interrupted', 'declined', 'interrupted'],
  );
});

test('Claude bookkeeping is not shown as something you wrote', () => {
  const user = (uuid: string, second: number, extra: object) => ({
    type: 'user',
    uuid,
    timestamp: at(second),
    message: { content: 'text' },
    ...extra,
  });
  const { messages } = claudeTranscript(session('claude'), [
    user('u1', 1, { message: { content: 'Fix the bug' } }),
    user('u2', 2, { message: { content: '[Request interrupted by user]' } }),
    user('u3', 3, { isCompactSummary: true, message: { content: 'Summary of earlier work' } }),
    user('u4', 4, { isVisibleInTranscriptOnly: true }),
    user('u5', 5, { is_meta: true }),
  ]);
  assert.deepEqual(
    messages.map((item) => item.text),
    ['Fix the bug'],
  );
});
