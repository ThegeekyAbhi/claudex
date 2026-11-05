import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PREFERENCES,
  type Message,
  mergeSnapshot,
  type Session,
  type Snapshot,
  sessionsForView,
  tailStart,
} from '../src/core/model';
import { Sessions } from '../src/harness/session-manager';

const long = (count: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: 'assistant' as const,
    text: 'word '.repeat(200),
  }));
const thread = (messages: Message[]): Session =>
  ({
    id: 't',
    provider: 'codex',
    title: 'T',
    cwd: '/x',
    workspace: '/x',
    status: 'running',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }) as Session;
const base = (session: Session): Snapshot => ({
  sessions: [session],
  documents: [],
  project: 'p',
  trusted: true,
  preferences: DEFAULT_PREFERENCES,
  catalog: {} as Snapshot['catalog'],
});

test('a streaming update stays small however long the thread is', () => {
  const messages = long(2000);
  const from = tailStart(messages);
  const full = JSON.stringify(messages).length;
  const tail = JSON.stringify(messages.slice(from)).length;
  assert.ok(tail < full / 100, `tail ${tail} of ${full} bytes`);
});
test('a running tool keeps the tail open until it reports', () => {
  const messages = long(100);
  messages[20].tool = { kind: 'command', name: 'x', title: 'x', status: 'running' };
  assert.equal(tailStart(messages), 20);
  messages[20].tool.status = 'completed';
  assert.equal(tailStart(messages), 88);
});
test('merging a tail gives the same transcript, and keeps earlier objects', () => {
  const messages = long(50);
  const previous = base(thread(messages.slice(0, 40)));
  const from = 38;
  const merged = mergeSnapshot(
    previous,
    {
      sessions: [thread(messages.slice(from))],
      project: 'p',
      trusted: true,
    },
    { id: 't', from },
  );
  assert.deepEqual(
    merged?.sessions[0].messages.map((item) => item.id),
    messages.map((item) => item.id),
  );
  assert.equal(merged?.sessions[0].messages[0], previous.sessions[0].messages[0]);
  assert.equal(merged?.catalog, previous.catalog);
});
test('a tail with nothing to attach to asks for a full snapshot', () => {
  const update = { sessions: [thread([])], project: 'p', trusted: true };
  assert.equal(mergeSnapshot(base(thread([])), update, { id: 't', from: 5 }), undefined);
});
test('other threads send a summary, not their history', () => {
  const other = { ...thread(long(10)), id: 'other', plan: undefined };
  const [selected, summary] = sessionsForView([thread(long(10)), other], 't');
  assert.equal(selected.messages.length, 10);
  assert.equal(summary.messages.length, 0);
});
test('sending reaches the provider without waiting on anything else', async () => {
  let reached = 0;
  const manager = new Sessions('/nonexistent', () => ({
    send: async () => {
      reached = performance.now();
    },
    interrupt: async () => {},
    dispose() {},
  }));
  const session = manager.create('codex', '/x', '/x', 'T');
  session.messages.push(...long(5000));
  const start = performance.now();
  await manager.send(session.id, 'hi');
  const overhead = reached - start;
  await manager.dispose().catch(() => {});
  assert.ok(overhead < 50, `took ${overhead.toFixed(1)} ms`);
});

test('two selected conversations merge independent streaming tails', () => {
  const first = { ...thread(long(30)), id: 'first' };
  const second = { ...thread(long(20)), id: 'second' };
  const all = [first, second];
  const viewA = structuredClone({ ...base(first), sessions: sessionsForView(all, first.id) });
  const viewB = structuredClone({ ...base(second), sessions: sessionsForView(all, second.id) });
  first.messages = [...first.messages, { id: 'new-a', role: 'assistant', text: 'A' }];
  second.messages = [...second.messages, { id: 'new-b', role: 'assistant', text: 'B' }];
  function update(view: Snapshot, selected: Session, from: number) {
    return mergeSnapshot(
      view,
      {
        ...view,
        sessions: sessionsForView([first, second], selected.id).map((item) =>
          item.id === selected.id ? { ...item, messages: item.messages.slice(from) } : item,
        ),
      },
      { id: selected.id, from },
    );
  }
  const nextA = update(viewA, first, 30);
  const nextB = update(viewB, second, 20);
  assert.deepEqual(nextA?.sessions.find((item) => item.id === 'first')?.messages, first.messages);
  assert.deepEqual(nextB?.sessions.find((item) => item.id === 'second')?.messages, second.messages);
  assert.equal(viewA.sessions.find((item) => item.id === 'first')?.messages.length, 30);
  assert.equal(viewB.sessions.find((item) => item.id === 'second')?.messages.length, 20);
});
