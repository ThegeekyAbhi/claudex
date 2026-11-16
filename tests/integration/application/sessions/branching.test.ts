import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { forkPoint, rewindPoint } from '../../../../src/application/sessions/session-branching';
import { Sessions } from '../../../../src/application/sessions/session-manager';
import { claudeResumeOptions } from '../../../../src/providers/claude/adapter';
import type { Message, Session } from '../../../../src/shared/model';
import { applyEvent } from '../../../../src/shared/protocol/events';

function thread(provider: Session['provider'] = 'claude'): Session {
  return {
    id: 't',
    provider,
    title: 'Task',
    cwd: '/x',
    workspace: '/x',
    status: 'completed',
    nativeId: 'native-1',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      { id: 'u1', role: 'user', text: 'first', nativeTurn: 'end-1', nativeSession: 'native-1' },
      { id: 'a1', role: 'assistant', text: 'one' },
      { id: 'u2', role: 'user', text: 'second', nativeTurn: 'end-2', nativeSession: 'native-1' },
      { id: 'tool', role: 'tool', text: '' },
      { id: 'a2', role: 'assistant', text: 'two' },
      { id: 'u3', role: 'user', text: 'third', nativeTurn: 'end-3', nativeSession: 'native-1' },
      { id: 'a3', role: 'assistant', text: 'three' },
    ],
  };
}

test('a fork keeps whole turns and branches at the turn’s native end', () => {
  const point = forkPoint(thread(), 'tool');
  assert.deepEqual(
    point.messages.map((message) => message.id),
    ['u1', 'a1', 'u2', 'tool', 'a2'],
  );
  assert.deepEqual(point.from, { nativeId: 'native-1', at: 'end-2' });
});

test('a turn with no native position cannot be forked, rather than guessing', () => {
  const session = thread('codex');
  delete session.messages[2].nativeTurn;
  assert.throws(() => forkPoint(session, 'a2'), /no saved position/);
});

test('Claude turns read from history use the last entry’s uuid', () => {
  const session = thread();
  delete session.messages[2].nativeTurn;
  session.messages[4].nativeRef = 'uuid-a2:0';
  assert.deepEqual(forkPoint(session, 'a2').from, { nativeId: 'native-1', at: 'uuid-a2' });
});

test('editing keeps the turns before, and the first message starts fresh', () => {
  assert.deepEqual(rewindPoint(thread(), 'u3'), {
    keep: 5,
    from: { nativeId: 'native-1', at: 'end-2' },
  });
  assert.deepEqual(rewindPoint(thread(), 'u1'), { keep: 0 });
  assert.throws(() => rewindPoint(thread(), 'a2'), /your own messages/);
});

test('turn ends land on your message; the branch’s own id clears the pending fork', () => {
  const session = thread();
  session.messages.push({ id: 'u4', role: 'user', text: 'four' });
  session.forkFrom = { nativeId: 'native-1', at: 'end-3' };
  session.nativeId = undefined;
  applyEvent(session, { type: 'nativeId', id: 'native-2' });
  assert.equal(session.forkFrom, undefined);
  applyEvent(session, { type: 'nativeTurn', ref: 'end-4' });
  const last = session.messages.at(-1) as Message;
  assert.equal(last.nativeTurn, 'end-4');
  assert.equal(last.nativeSession, 'native-2');
});

test('Claude resumes its own session, or forks the source once', () => {
  assert.deepEqual(claudeResumeOptions({ nativeId: 'a' }), { resume: 'a' });
  assert.deepEqual(claudeResumeOptions({ forkFrom: { nativeId: 's', at: 'e' } }), {
    resume: 's',
    forkSession: true,
    resumeSessionAt: 'e',
  });
  assert.deepEqual(claudeResumeOptions({ nativeId: 'a', forkFrom: { nativeId: 's' } }), {
    resume: 'a',
  });
  assert.deepEqual(claudeResumeOptions({}), {});
});

test('fork makes a new thread and leaves the source alone; rewind keeps the local id', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'branching-'));
  const sent: { id: string; text: string; nativeId?: string; forkFrom?: Session['forkFrom'] }[] =
    [];
  const manager = new Sessions(storage, (session) => ({
    send: async (text) => {
      sent.push({ id: session.id, text, nativeId: session.nativeId, forkFrom: session.forkFrom });
    },
    interrupt: async () => {},
    dispose() {},
  }));
  const source = manager.create('claude', storage, storage, 'Task');
  Object.assign(source, { ...thread(), id: source.id });
  const before = structuredClone(source.messages);
  const fork = manager.fork(source.id, 'a2');
  assert.notEqual(fork.id, source.id);
  assert.equal(fork.nativeId, undefined);
  assert.deepEqual(fork.forkFrom, { nativeId: 'native-1', at: 'end-2' });
  assert.equal(fork.continuedFrom, source.id);
  assert.equal(fork.messages.filter((message) => message.role === 'user').length, 2);
  assert.deepEqual(source.messages, before);

  source.status = 'running';
  assert.throws(() => manager.fork(source.id, 'a2'), /Stop this thread/);
  source.status = 'completed';

  await manager.rewind(source.id, 'u3', 'third, edited');
  assert.equal(source.id, manager.get(source.id).id);
  assert.equal(source.nativeId, undefined);
  assert.equal(source.previousAgents?.at(-1)?.nativeId, 'native-1');
  assert.deepEqual(sent.at(-1), {
    id: source.id,
    text: 'third, edited',
    nativeId: undefined,
    forkFrom: { nativeId: 'native-1', at: 'end-2' },
  });
  assert.ok(!source.messages.some((message) => message.id === 'a3' || message.id === 'u3'));
  assert.ok(
    source.messages.some((message) =>
      /files the agent changed were not reverted/.test(message.text),
    ),
  );
  await manager.dispose().catch(() => {});
});

test('after continuing in another agent, earlier turns can’t be forked or rewound with their ids', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'branching-'));
  const manager = new Sessions(storage, () => ({
    send: async () => {},
    interrupt: async () => {},
    dispose() {},
  }));
  const source = manager.create('claude', storage, storage, 'Task');
  Object.assign(source, { ...thread(), id: source.id });
  source.forkFrom = { nativeId: 'native-0', at: 'end-0' };
  manager.continueChat(source.id, 'codex', undefined, 'context');
  // The pending Claude branch would otherwise be handed to Codex on the next send.
  assert.equal(source.forkFrom, undefined);
  assert.deepEqual(source.messages[0].nativeOwner, { provider: 'claude' });
  assert.throws(() => manager.fork(source.id, 'a2'), /ran with Claude[\s\S]*Codex[\s\S]*new chat/);
  assert.throws(() => rewindPoint(manager.get(source.id), 'u3'), /ran with Claude/);

  // A turn Codex ran after the switch is Codex's own, so it forks normally.
  source.nativeId = 'codex-thread';
  source.messages.push({ id: 'u4', role: 'user', text: 'fourth' });
  applyEvent(source, { type: 'nativeTurn', ref: 'turn-4' });
  source.messages.push({ id: 'a4', role: 'assistant', text: 'four' });
  const fork = manager.fork(source.id, 'a4');
  assert.equal(fork.provider, 'codex');
  assert.deepEqual(fork.forkFrom, { nativeId: 'codex-thread', at: 'turn-4' });
  // The fork keeps the record, so its copied Claude turns stay Claude's.
  assert.throws(() => manager.fork(fork.id, 'a2'), /ran with Claude/);
  await manager.dispose().catch(() => {});
});

test('a switched thread saved before owners were recorded fails closed', () => {
  const session = thread('codex');
  session.previousAgents = [{ provider: 'claude', nativeId: 'native-1' }];
  assert.throws(() => forkPoint(session, 'a2'), /ran with an earlier agent/);
});

test('Claude history rows from another agent are not used as Claude positions', () => {
  const session = thread();
  delete session.messages[2].nativeTurn;
  session.messages[4].nativeRef = 'item-from-codex:0';
  session.messages[4].nativeOwner = { provider: 'codex' };
  assert.throws(() => forkPoint(session, 'a2'), /ran with Codex/);
});
