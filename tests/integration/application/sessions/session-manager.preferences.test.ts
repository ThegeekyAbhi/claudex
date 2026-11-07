import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Sessions } from '../../../../src/application/sessions/session-manager';
import { EXPLAIN_GUIDE_VERSION } from '../../../../src/shared/guidance/explain-guidance';
import {
  type Approval,
  actionSchema,
  type EventSink,
  parseAppearance,
  type Session,
  threadTitle,
} from '../../../../src/shared/model';

async function fixture(
  t: TestContext,
  { rich = true, guided = true, failAuto = false } = {},
): Promise<{ manager: Sessions; session: Session; sent: string[] }> {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-preferences-'));
  const sent: string[] = [];
  const manager = new Sessions(
    storage,
    (session) => ({
      send: async (text) => {
        if (failAuto && session.mode === 'auto') throw new Error('Auto is unavailable');
        sent.push(text);
      },
      interrupt: async () => {},
      dispose() {},
    }),
    1500,
    undefined,
    () => guided,
    () => rich,
  );
  t.after(() => manager.dispose());
  return { manager, session: manager.create('codex', storage, storage, 'Test'), sent };
}

test('preference actions accept known values only', () => {
  const accepts = (raw: unknown) => actionSchema.safeParse(raw).success;
  assert.ok(accepts({ type: 'setAppearance', appearance: 'cursor' }));
  assert.ok(accepts({ type: 'setAppearance', appearance: 'editor' }));
  assert.ok(!accepts({ type: 'setAppearance', appearance: 'neon' }));
  assert.ok(accepts({ type: 'setGuide', guide: 'guidedPlanning', enabled: false }));
  assert.ok(accepts({ type: 'setGuide', guide: 'richExplanations', enabled: true }));
  assert.ok(!accepts({ type: 'setGuide', guide: 'codexPath', enabled: true }));
  assert.ok(!accepts({ type: 'setGuide', guide: 'guidedPlanning', enabled: 'yes' }));
  assert.equal(parseAppearance('editor'), 'editor');
  assert.equal(parseAppearance('linear'), 'cursor', 'an old value falls back');
  assert.equal(parseAppearance('anything else'), 'cursor');
});

test('Ask messages carry the explanation guide, and record it', async (t) => {
  const { manager, session, sent } = await fixture(t);
  manager.setMode(session.id, 'ask');
  await manager.send(session.id, 'How does this work?');
  assert.equal(sent[0].match(/<explanation-guide /g)?.length, 1);
  assert.doesNotMatch(sent[0], /<planning-guide /);
  const message = session.messages.at(-1);
  assert.equal(message?.text, 'How does this work?');
  assert.equal(message?.explainGuideVersion, EXPLAIN_GUIDE_VERSION);
});

test('turning explanations off leaves Ask input unchanged', async (t) => {
  const { manager, session, sent } = await fixture(t, { rich: false });
  manager.setMode(session.id, 'ask');
  await manager.send(session.id, 'How does this work?');
  assert.equal(sent[0], 'How does this work?');
  assert.equal(session.messages.at(-1)?.explainGuideVersion, undefined);
});

test('other modes do not get the explanation guide', async (t) => {
  const { manager, session, sent } = await fixture(t);
  manager.setMode(session.id, 'auto');
  await manager.send(session.id, 'Change it');
  assert.equal(sent[0], 'Change it');
});

test('guides stay out of a message with a skill, whose arguments they would join', async (t) => {
  for (const mode of ['ask', 'plan'] as const) {
    const { manager, session, sent } = await fixture(t);
    manager.setMode(session.id, mode);
    await manager.send(session.id, 'Use the skill', {
      skills: [{ name: 'review' }] as never,
    });
    assert.equal(sent[0], 'Use the skill');
    assert.equal(session.messages.at(-1)?.planningGuideVersion, undefined);
    assert.equal(session.messages.at(-1)?.explainGuideVersion, undefined);
  }
});

test('building a plan in Auto runs in Auto and marks the plan approved', async (t) => {
  const { manager, session, sent } = await fixture(t);
  manager.setMode(session.id, 'plan');
  session.plan = { text: 'The plan', status: 'ready' } as Session['plan'];
  await manager.buildPlan(session.id);
  assert.equal(session.mode, 'auto');
  assert.equal(session.plan?.status, 'approved');
  assert.equal(sent[0], 'Implement the plan.');
});

test('a build that cannot start puts the mode and plan back, and says why', async (t) => {
  const { manager, session } = await fixture(t, { failAuto: true });
  manager.setMode(session.id, 'plan');
  session.plan = { text: 'The plan', status: 'ready' } as Session['plan'];
  await manager.buildPlan(session.id);
  assert.equal(session.mode, 'plan');
  assert.equal(session.plan?.status, 'ready');
  assert.equal(session.status, 'failed');
  assert.match(session.messages.at(-1)?.text ?? '', /Auto is unavailable/);
});

test('Allow in Auto grants the one request, then moves the thread to Auto', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-allow-auto-'));
  const answers: boolean[] = [];
  let emit: EventSink = () => {};
  const manager = new Sessions(storage, (_session, sink) => {
    emit = sink;
    return { send: async () => {}, interrupt: async () => {}, dispose() {} };
  });
  t.after(() => manager.dispose());
  const session = manager.create('claude', storage, storage, 'Test');
  await manager.send(session.id, 'Go');
  const ask = (id: string, approval: Partial<Approval> = {}) =>
    emit({
      type: 'approval',
      approval: { id, title: 'Run?', detail: '', origin: 'provider', ...approval },
      respond: (allowed) => answers.push(allowed),
    });
  ask('one');
  manager.allowInAuto(session.id, 'one');
  assert.deepEqual(answers, [true]);
  assert.equal(session.mode, 'auto');
  // Only an ordinary tool request. Anything else is answered on its own, and stays pending.
  session.mode = 'plan';
  ask('delegated', { origin: 'delegation' });
  assert.throws(() => manager.allowInAuto(session.id, 'delegated'), /on its own/);
  manager.approve(session.id, 'delegated', false, {});
  ask('question', { questions: [{ id: 'q', prompt: 'Which?' }] as Approval['questions'] });
  assert.throws(() => manager.allowInAuto(session.id, 'question'), /on its own/);
  manager.approve(session.id, 'question', false, {});
  assert.equal(session.mode, 'plan');
  assert.deepEqual(answers, [true, false, false]);
  assert.throws(() => manager.allowInAuto(session.id, 'gone'), /no longer pending/);
});
test('Codex Allow in Auto needs an on-request policy, and grants nothing without it', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-allow-codex-'));
  const answers: boolean[] = [];
  let emit: EventSink = () => {};
  const manager = new Sessions(storage, (_session, sink) => {
    emit = sink;
    return { send: async () => {}, interrupt: async () => {}, dispose() {} };
  });
  t.after(() => manager.dispose());
  const session = manager.create('codex', storage, storage, 'Test');
  await manager.send(session.id, 'Go');
  emit({
    type: 'approval',
    approval: { id: 'one', title: 'Run?', detail: '', origin: 'provider' },
    respond: (allowed) => answers.push(allowed),
  });
  assert.throws(() => manager.allowInAuto(session.id, 'one'), /on-request/);
  assert.deepEqual(answers, []);
  assert.notEqual(session.mode, 'auto');
});
test('titles leave out image references', () => {
  assert.equal(threadTitle('[Image #1] i want a pet'), 'i want a pet');
  assert.equal(threadTitle('j[Image #1] remove [Image #2] this'), 'j remove this');
  assert.equal(threadTitle('[Image #3]'), 'Image');
  assert.equal(threadTitle('', 'New chat'), 'New chat');
});
