import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeNative, syncCursor } from '../../../../src/application/sessions/session-sync';
import type { Message, Session } from '../../../../src/shared/model';

function thread(extra: Partial<Session> = {}): Session {
  return {
    id: 'thread',
    provider: 'claude',
    title: 'Thread',
    cwd: '/project',
    workspace: '/project',
    nativeId: 'native',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 100,
    ...extra,
  };
}
const row = (ref: string, at: number, extra: Partial<Message> = {}): Message => ({
  id: `native-${ref}`,
  role: 'assistant',
  text: ref,
  nativeRef: `${ref}:0`,
  startedAt: at,
  ...extra,
});

test('a terminal-only session opens with everything the CLI recorded and no extra notice', () => {
  const session = thread({ origin: 'terminal' });
  const outcome = mergeNative(
    session,
    { messages: [row('a', 10, { role: 'user' }), row('b', 20)], skipped: 0 },
    { announce: false },
  );
  assert.equal(outcome.added, 2);
  assert.deepEqual(
    session.messages.map((item) => item.text),
    ['a', 'b'],
  );
  assert.equal(session.nativeSyncedAt, 20);
});

test('only what the terminal added after the last turn here is appended, once', () => {
  const session = thread({
    nativeSyncedAt: 50,
    messages: [{ id: 'mine', role: 'assistant', text: 'From a turn run here' }],
  });
  const rows = {
    // The turn run here is in the CLI transcript too, before the cursor.
    messages: [row('here', 40), row('later', 60, { role: 'user' }), row('reply', 70)],
    skipped: 0,
  };
  const first = mergeNative(session, rows, { announce: true });
  assert.equal(first.added, 2);
  assert.equal(session.messages[1].role, 'notice');
  assert.match(session.messages[1].text, /From the terminal: 2 messages/);
  assert.equal(session.nativeSyncedAt, 70);
  const second = mergeNative(session, rows, { announce: true });
  assert.equal(second.added, 0, 'reading again adds nothing');
  assert.equal(session.messages.length, 4);
});

test('a thread saved by an older Claudex uses its last change, so nothing shows twice', () => {
  const older = thread({ messages: [{ id: 'mine', role: 'user', text: 'Hi' }], updatedAt: 100 });
  assert.equal(syncCursor(older), 100);
  mergeNative(
    older,
    { messages: [row('old', 90), row('new', 110)], skipped: 0 },
    { announce: true },
  );
  assert.deepEqual(
    older.messages.filter((item) => item.role !== 'notice').map((item) => item.text),
    ['Hi', 'new'],
  );
});

test('a tool call shown as unfinished takes the outcome the CLI recorded later', () => {
  const session = thread({
    nativeSyncedAt: 50,
    messages: [
      {
        id: 'tool-1',
        role: 'tool',
        text: '',
        tool: { kind: 'command', name: 'Bash', title: 'make', status: 'interrupted' },
      },
    ],
  });
  const outcome = mergeNative(
    session,
    {
      messages: [
        {
          id: 'tool-1',
          role: 'tool',
          text: 'built',
          nativeRef: 't:0',
          startedAt: 40,
          tool: { kind: 'command', name: 'Bash', title: 'make', status: 'completed' },
        },
      ],
      skipped: 0,
    },
    { announce: true },
  );
  assert.equal(outcome.updated, 1);
  assert.equal(session.messages[0].tool?.status, 'completed');
  assert.equal(session.messages[0].text, 'built');
});

test('unreadable entries are reported once, on the first read, and never guessed', () => {
  const session = thread();
  mergeNative(session, { messages: [row('a', 10)], skipped: 2 }, { announce: false });
  assert.match(session.messages.at(-1)?.text ?? '', /2 entries .* no time recorded/);
  const notices = () => session.messages.filter((item) => item.role === 'notice').length;
  const before = notices();
  mergeNative(session, { messages: [row('a', 10)], skipped: 2 }, { announce: false });
  assert.equal(notices(), before);
});

test('a thread opened from the terminal reads everything, even after a failed first read', () => {
  // `open()` sets the cursor to 0 and may then fail to read, leaving a notice behind.
  const session = thread({
    origin: 'terminal',
    nativeSyncedAt: undefined,
    messages: [{ id: 'unread', role: 'notice', text: 'Couldn’t read' }],
  });
  assert.equal(syncCursor(session), 0);
  const outcome = mergeNative(
    session,
    { messages: [row('a', 10, { role: 'user' }), row('b', 20)], skipped: 0 },
    { announce: false },
  );
  assert.equal(outcome.added, 2);
});

test('records at the cursor time are added once: later items of one Codex turn share its time', () => {
  const session = thread({ nativeSyncedAt: 0 });
  mergeNative(session, { messages: [row('a', 50)], skipped: 0 }, { announce: false });
  assert.equal(session.nativeSyncedAt, 50);
  const outcome = mergeNative(
    session,
    { messages: [row('a', 50), row('b', 50)], skipped: 0 },
    { announce: false },
  );
  assert.equal(outcome.added, 1);
  assert.deepEqual(
    session.messages.map((item) => item.text),
    ['a', 'b'],
  );
});

test('the no-time notice is said once even when every record lacks a time', () => {
  const session = thread({ nativeSyncedAt: 0 });
  mergeNative(session, { messages: [], skipped: 3 }, { announce: false });
  mergeNative(session, { messages: [], skipped: 3 }, { announce: false });
  assert.equal(session.messages.filter((item) => item.role === 'notice').length, 1);
});
