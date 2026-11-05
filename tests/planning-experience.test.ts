import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { actionSchema, type EventSink, thinkingSupport } from '../src/core/model';
import { PLANNING_GUIDE_VERSION } from '../src/harness/planning-guidance';
import { Sessions } from '../src/harness/session-manager';
import { describeClaudeTool } from '../src/providers/tool-format';

async function fixture(t: TestContext, stop: () => Promise<void> = async () => {}, guide = true) {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-planning-'));
  const sent: { text: string; nativeId?: string; mode?: string }[] = [];
  const emitters: EventSink[] = [];
  const manager = new Sessions(
    storage,
    (session, emit) => {
      emitters.push(emit);
      return {
        send: async (text) => {
          sent.push({ text, nativeId: session.nativeId, mode: session.mode });
        },
        interrupt: stop,
        dispose() {},
      };
    },
    1500,
    undefined,
    () => guide,
  );
  t.after(() => manager.dispose());
  const session = manager.create('codex', storage, storage, 'Test');
  session.nativeId = 'native-existing';
  session.nativeSettings = { approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } };
  await manager.send(session.id, 'Original task');
  let grants = 0;
  const pending = (origin: 'provider' | 'delegation' = 'provider') =>
    emitters[0]({
      type: 'approval',
      approval: {
        id: 'request',
        title: 'Run command?',
        detail: 'secret command must not be replayed',
        origin,
      },
      respond: (allowed) => {
        if (allowed) grants++;
      },
    });
  return { manager, session, sent, emitters, pending, grants: () => grants, storage };
}

test('native Auto waits for stop, preserves identity, and never grants or replays the request', async (t) => {
  let release = () => {};
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { manager, session, pending, sent, emitters, grants } = await fixture(t, () => stopped);
  pending();
  const transition = manager.resumeInAuto(session.id, 'request');
  assert.equal(session.transition, 'stopping');
  assert.equal(sent.length, 1);
  await assert.rejects(manager.resumeInAuto(session.id, 'request'), /transition/);
  await assert.rejects(manager.send(session.id, 'competing'), /transition/);
  assert.throws(() => manager.approve(session.id, 'request', true, {}), /transition/);
  assert.throws(() => manager.setMode(session.id, 'agent'), /transition/);
  release();
  await transition;
  assert.equal(sent.length, 2);
  assert.equal(sent[1].nativeId, 'native-existing');
  assert.equal(sent[1].mode, 'auto');
  assert.doesNotMatch(sent[1].text, /secret command/);
  assert.equal(grants(), 0);
  emitters[0]({ type: 'status', status: 'completed' });
  assert.equal(session.status, 'running', 'late old events are ignored');
  assert.equal(session.transition, undefined);
});

test('Stop cancels an Auto continuation while interruption is settling', async (t) => {
  let release = () => {};
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { manager, session, pending, sent } = await fixture(t, () => stopped);
  pending();
  const transition = manager.resumeInAuto(session.id, 'request');
  await manager.interrupt(session.id);
  release();
  await transition;
  assert.equal(sent.length, 1);
  assert.equal(session.status, 'interrupted');
  assert.equal(session.mode, undefined);
});

test('failure to persist the stopped session prevents continuation', async (t) => {
  const { manager, session, pending, sent } = await fixture(t);
  const flush = manager.flush.bind(manager);
  pending();
  manager.flush = async () => {
    throw new Error('disk full');
  };
  try {
    await manager.resumeInAuto(session.id, 'request');
    assert.equal(sent.length, 1);
    assert.equal(session.status, 'failed');
    assert.match(session.messages.at(-1)?.text ?? '', /disk full/);
  } finally {
    manager.flush = flush;
  }
});

test('an earlier continuation cannot clear a newer Auto transition', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-auto-repeat-'));
  const emitters: EventSink[] = [];
  const inputs: string[] = [];
  let finishFirstContinuation = () => {};
  let finishSecondStop = () => {};
  const secondStop = new Promise<void>((resolve) => {
    finishSecondStop = resolve;
  });
  const firstContinuation = new Promise<void>((resolve) => {
    finishFirstContinuation = resolve;
  });
  const manager = new Sessions(storage, (_session, emit) => {
    const index = emitters.length;
    emitters.push(emit);
    return {
      send: async (text) => {
        inputs.push(text);
        if (index === 1) await firstContinuation;
      },
      interrupt: async () => {
        if (index === 1) {
          finishFirstContinuation();
          await secondStop;
        }
      },
      dispose() {},
    };
  });
  t.after(() => manager.dispose());
  const session = manager.create('claude', storage, storage, 'Repeated Auto');
  session.nativeId = 'same-session';
  await manager.send(session.id, 'Task');
  const approval = (index: number, id: string) =>
    emitters[index]({
      type: 'approval',
      approval: { id, title: 'Tool?', detail: '', origin: 'provider' },
      respond() {},
    });
  approval(0, 'first');
  const first = manager.resumeInAuto(session.id, 'first');
  for (let attempt = 0; attempt < 100 && inputs.length < 2; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.transition, undefined, 'new approvals are usable during the resumed turn');
  approval(1, 'second');
  const second = manager.resumeInAuto(session.id, 'second');
  await first;
  assert.equal(session.transition, 'stopping');
  await assert.rejects(manager.send(session.id, 'conflicting'), /transition/);
  finishSecondStop();
  await second;
  assert.equal(inputs.length, 3);
  assert.equal(session.nativeId, 'same-session');
});

test('stop failure is truthful and never starts another provider turn', async (t) => {
  const { manager, session, pending, sent } = await fixture(t, async () => {
    throw new Error('stop rejected');
  });
  pending();
  await manager.resumeInAuto(session.id, 'request');
  assert.equal(sent.length, 1);
  assert.equal(session.status, 'failed');
  assert.equal(session.nativeId, 'native-existing');
  assert.match(session.messages.at(-1)?.text ?? '', /confirm the turn stopped/);
});

test('Auto rejects stale, delegation, observed, and incompatible permission requests', async (t) => {
  const { manager, session, pending, sent } = await fixture(t);
  pending();
  await assert.rejects(manager.resumeInAuto(session.id, 'stale'), /eligible/);
  pending('delegation');
  await assert.rejects(manager.resumeInAuto(session.id, 'request'), /eligible/);
  pending();
  session.observed = true;
  await assert.rejects(manager.resumeInAuto(session.id, 'request'), /eligible/);
  session.observed = false;
  session.nativeSettings = { approvalPolicy: 'never' };
  await assert.rejects(manager.resumeInAuto(session.id, 'request'), /on-request/);
  assert.equal(sent.length, 1);
});

test('guided planning preserves user input, records provenance, and excludes implementation turns', async (t) => {
  const { manager, session, sent, emitters, storage } = await fixture(t);
  emitters[0]({ type: 'status', status: 'completed' });
  manager.setMode(session.id, 'plan');
  await manager.send(session.id, 'Plan this simply', {
    context: 'Existing context',
    attachments: [{ kind: 'file', path: 'a.ts' }],
  });
  const message = session.messages.at(-1);
  assert.equal(message?.text, 'Plan this simply');
  assert.equal(message?.planningGuideVersion, PLANNING_GUIDE_VERSION);
  assert.deepEqual(message?.attachments, [{ kind: 'file', path: 'a.ts' }]);
  assert.match(sent[1].text, /Existing context/);
  assert.equal(sent[1].text.match(/<planning-guide /g)?.length, 1);
  await manager.flush();
  const saved = JSON.parse(await readFile(path.join(storage, 'sessions.json'), 'utf8'));
  assert.equal(saved.sessions[0].messages.at(-1).planningGuideVersion, PLANNING_GUIDE_VERSION);
  emitters[0]({ type: 'status', status: 'completed' });
  manager.setMode(session.id, 'agent');
  await manager.send(session.id, 'Implement it');
  assert.equal(sent[2].text, 'Implement it');
});

test('disabling guided planning leaves provider input unchanged', async (t) => {
  const { manager, session, emitters, sent } = await fixture(t, undefined, false);
  emitters[0]({ type: 'status', status: 'completed' });
  manager.setMode(session.id, 'plan');
  await manager.send(session.id, 'Plan only');
  assert.equal(sent[1].text, 'Plan only');
  assert.equal(session.messages.at(-1)?.planningGuideVersion, undefined);
});

test('thinking controls use model capabilities and resolved identities without guessing', () => {
  const model = { id: 'alias', label: 'Model', description: '', efforts: ['none', 'low'] };
  assert.equal(thinkingSupport('codex', model).off, true);
  assert.equal(thinkingSupport('codex', { ...model, efforts: ['low'] }).off, false);
  assert.equal(thinkingSupport('claude', { ...model, adaptiveThinking: true }).off, false);
  assert.equal(
    thinkingSupport('claude', {
      ...model,
      resolvedModel: 'claude-sonnet-4-6',
      adaptiveThinking: true,
    }).off,
    true,
  );
  assert.equal(
    thinkingSupport('claude', {
      ...model,
      resolvedModel: 'claude-sonnet-5-5',
      adaptiveThinking: true,
    }).off,
    false,
  );
  assert.equal(thinkingSupport('codex').on, false);
  assert.equal(
    actionSchema.safeParse({ type: 'setThinking', id: 'x', thinking: 'invented' }).success,
    false,
  );
});

test('known structured skill reads differ from invocation and ambiguous reads', () => {
  const skills = [{ name: 'review', path: '/skills/review/SKILL.md' }];
  const read = describeClaudeTool('Read', { file_path: skills[0].path }, '/project', skills);
  assert.equal(read.kind, 'read');
  assert.equal(read.skill?.phase, 'read');
  assert.equal(
    describeClaudeTool('Read', { file_path: '/other/SKILL.md' }, '/project', skills).skill,
    undefined,
  );
  assert.equal(describeClaudeTool('Skill', { skill: 'review' }).skill?.phase, 'invoke');
});
