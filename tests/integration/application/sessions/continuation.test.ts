import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Sessions } from '../../../../src/application/sessions/session-manager';
import { chooseNudge, limitFailure } from '../../../../src/shared/domain/nudges';

test('continuation preserves transcript and native IDs, persists without starting work', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'continuation-'));
  let calls = 0;
  const factory = () => {
    calls++;
    throw new Error('must not start');
  };
  const manager = new Sessions(storage, factory);
  const session = manager.create('claude', storage, storage, 'Task', undefined, 'personal-claude');
  session.nativeId = 'original-native-id';
  session.status = 'failed';
  session.messages.push(
    { id: 'user', role: 'user', text: 'Continue my task' },
    { id: 'limit', role: 'notice', text: "You've hit your 5-hour limit · resets 2:10am" },
  );
  session.usage = { updatedAt: 1, limits: [{ id: 'five_hour', label: '5-hour', usedPercent: 88 }] };
  assert.ok(limitFailure(session));
  assert.equal(chooseNudge(session, 'personal-claude', undefined, [])?.text, 'Limit reached.');
  session.plan = { text: '# Original plan', status: 'ready', updatedAt: 1 };
  manager.continueChat(session.id, 'codex', undefined, 'Reviewed task context');
  assert.ok(session.messages.some((message) => message.text.includes('# Original plan')));
  assert.equal(session.plan, undefined);
  assert.equal(session.messages[0].text, 'Continue my task');
  assert.equal(session.nativeId, undefined);
  assert.equal(session.previousAgents?.[0].nativeId, 'original-native-id');
  assert.equal(session.usage, undefined);
  assert.equal(limitFailure(session), undefined);
  assert.equal(session.continuationContext, 'Reviewed task context');
  await manager.dispose();
  const restored = new Sessions(storage, factory);
  await restored.load();
  assert.equal(restored.get(session.id).previousAgents?.[0].profileId, 'personal-claude');
  assert.equal(restored.get(session.id).continuationContext, 'Reviewed task context');
  assert.equal(calls, 0);
  await restored.dispose();
});

test('running threads cannot switch providers and an old failure does not block a new turn', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'continuation-'));
  const manager = new Sessions(storage, () => {
    throw new Error('must not start');
  });
  const session = manager.create('claude', storage, storage, 'Task');
  session.status = 'running';
  assert.throws(() => manager.continueChat(session.id, 'codex', undefined, ''), /Stop this thread/);
  assert.equal(session.provider, 'claude');
  session.status = 'failed';
  session.messages.push(
    { id: 'old', role: 'notice', text: "You've hit your 5-hour limit" },
    { id: 'new', role: 'user', text: 'try again' },
  );
  assert.equal(limitFailure(session), undefined);
  await manager.dispose();
});

test('a failed continuation keeps reviewed context for retry and a completed turn clears it', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'continuation-'));
  const prompts: string[] = [];
  let fail = true;
  const manager = new Sessions(storage, (_session, emit) => ({
    send: async (text) => {
      prompts.push(text);
      emit({ type: 'status', status: fail ? 'failed' : 'completed' });
    },
    interrupt: async () => {},
    dispose() {},
  }));
  const session = manager.create('claude', storage, storage, 'Task');
  manager.continueChat(session.id, 'codex', undefined, 'Reviewed context');
  await manager.send(session.id, 'Continue');
  assert.equal(session.continuationContext, 'Reviewed context');
  fail = false;
  await manager.send(session.id, 'Try again');
  assert.ok(prompts.every((prompt) => prompt.includes('Reviewed context')));
  assert.equal(session.continuationContext, undefined);
  await manager.dispose();
});
