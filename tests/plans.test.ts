import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { type AgentEvent, planSummary, planTitle, planViewActionSchema } from '../src/core/model';
import { Sessions } from '../src/harness/session-manager';
import { PlanStore } from '../src/host/plans';

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-plans-'));
  const sent: string[] = [];
  const emitters: ((event: AgentEvent) => void)[] = [];
  const plans = new PlanStore(path.join(root, 'plans'));
  const manager = new Sessions(
    root,
    (_session, emit) => {
      emitters.push(emit);
      return {
        send: async (text: string) => {
          sent.push(text);
        },
        interrupt: async () => {},
        dispose: () => {},
      };
    },
    0,
    plans,
  );
  await manager.load();
  const session = manager.create('codex', root, root, 'Cache');
  await manager.send(session.id, 'Plan it');
  const emit = (event: AgentEvent) => emitters[0]?.(event);
  return { root, sent, manager, session, emit, plans };
}
async function until(ready: () => unknown) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out.');
}

test('a finished plan is saved as ordinary Markdown outside the repo', async () => {
  const { root, session, emit } = await setup();
  emit({ type: 'plan', text: '# Render cache\n\nDo it.', final: true });
  await until(() => session.plan?.file);
  const file = session.plan?.file ?? '';
  assert.ok(file.startsWith(path.join(root, 'plans')));
  assert.match(path.basename(file), /^render_cache_[a-zA-Z0-9]+\.plan\.md$/);
  assert.equal(await readFile(file, 'utf8'), '# Render cache\n\nDo it.\n');
});

test('a draft is not saved, and a revised plan keeps its file', async () => {
  const { session, emit } = await setup();
  emit({ type: 'plan', text: '# First', final: false });
  assert.equal(session.plan?.file, undefined);
  emit({ type: 'plan', text: '# First', final: true });
  await until(() => session.plan?.file);
  const file = session.plan?.file;
  emit({ type: 'plan', text: '# Second', final: true });
  assert.equal(session.plan?.file, file);
  await until(async () => (await readFile(file ?? '', 'utf8')).includes('Second'));
});

test('Build uses the file as you left it', async () => {
  const { sent, manager, session, emit } = await setup();
  emit({ type: 'plan', text: '# Plan\n\nOriginal.', final: true });
  emit({ type: 'status', status: 'completed' });
  await until(() => session.plan?.file);
  await writeFile(session.plan?.file ?? '', '# Plan\n\nEdited by hand.\n');
  await manager.buildPlan(session.id);
  assert.match(sent.at(-1) ?? '', /Edited by hand/);
  assert.equal(session.mode, 'auto');
  assert.equal(session.plan?.status, 'approved');
  assert.equal(session.status, 'running', 'building is not done');
});

test('an unedited plan does not get pasted back', async () => {
  const { sent, manager, session, emit } = await setup();
  emit({ type: 'plan', text: '# Plan\n\nOriginal.', final: true });
  emit({ type: 'status', status: 'completed' });
  await until(() => session.plan?.file);
  await manager.buildPlan(session.id);
  assert.equal(sent.at(-1), 'Implement the plan.');
});

test('a deleted plan file falls back to the plan in the thread, an emptied one refuses', async () => {
  const { sent, manager, session, emit } = await setup();
  emit({ type: 'plan', text: '# Plan\n\nOriginal.', final: true });
  emit({ type: 'status', status: 'completed' });
  await until(() => session.plan?.file);
  await writeFile(session.plan?.file ?? '', '  \n');
  await assert.rejects(manager.buildPlan(session.id), /plan file is empty/);
  assert.equal(session.plan?.status, 'ready', 'a refused build changes nothing');
  if (session.plan) session.plan.file = `${session.plan.file}.gone`;
  await manager.buildPlan(session.id);
  assert.equal(sent.at(-1), 'Implement the plan.');
});

test('checked boxes in a plan do not mark anything complete', async () => {
  const { session, emit } = await setup();
  emit({ type: 'plan', text: '- [x] Done\n- [x] Also done', final: true });
  assert.equal(session.plan?.status, 'ready');
  assert.equal(session.status, 'running');
});

test('feedback goes back with the answer and shows in the thread', async () => {
  const { manager, session, emit } = await setup();
  emit({ type: 'plan', text: '# Plan', final: true });
  const answers: [boolean, Record<string, string>][] = [];
  emit({
    type: 'approval',
    approval: { id: 'p', title: 'Build this plan?', detail: '', kind: 'plan' },
    respond: (allowed, given) => answers.push([allowed, given]),
  });
  manager.keepPlanning(session.id, 'Smaller, please');
  assert.deepEqual(answers, [[false, { feedback: 'Smaller, please' }]]);
  assert.equal(session.messages.at(-1)?.text, 'Smaller, please');
  assert.equal(session.messages.at(-1)?.role, 'user');
});

test('building with edits answers a waiting plan request with the edited text', async () => {
  const { manager, session, emit } = await setup();
  emit({ type: 'plan', text: '# Plan', final: true });
  await until(() => session.plan?.file);
  await writeFile(session.plan?.file ?? '', '# Plan\n\nEdited.\n');
  const answers: Record<string, string>[] = [];
  emit({
    type: 'approval',
    approval: { id: 'p', title: 'Build this plan?', detail: '', kind: 'plan' },
    respond: (_allowed, given) => answers.push(given),
  });
  await manager.buildPlan(session.id);
  assert.deepEqual(answers, [{ plan: '# Plan\n\nEdited.\n' }]);
});

test('handing a plan to another agent carries the text and declines the waiting request', async () => {
  const { manager, session, emit } = await setup();
  emit({ type: 'plan', text: '# Plan\n\nSteps.', final: true });
  await until(() => session.plan?.file);
  const answers: boolean[] = [];
  emit({
    type: 'approval',
    approval: { id: 'p', title: 'Build this plan?', detail: '', kind: 'plan' },
    respond: (allowed) => answers.push(allowed),
  });
  assert.match(await manager.handOffPlan(session.id), /Implement this plan:\n\n# Plan\n\nSteps/);
  assert.deepEqual(answers, [false]);
  assert.equal(session.plan?.status, 'approved');
});

test('plan titles and summaries come from the Markdown', () => {
  assert.equal(planTitle('Intro\n\n## Render cache\n', 'Thread'), 'Render cache');
  assert.equal(planTitle('No heading', 'Thread'), 'Thread');
  assert.equal(planSummary('# T\n\n- item\n\nFirst   real\nline.\n\nNext.'), 'First real line.');
  assert.equal(planSummary('# Only a title'), '');
});

test('the plan editor rejects messages it does not know', () => {
  // A build always means Auto, so a message can't name another mode.
  assert.deepEqual(planViewActionSchema.parse({ type: 'planBuild', mode: 'bypass' }), {
    type: 'planBuild',
  });
  assert.ok(!planViewActionSchema.safeParse({ type: 'planBuild', agent: 'gpt' }).success);
  assert.ok(!planViewActionSchema.safeParse({ type: 'send', text: 'x' }).success);
});

test('deleting a stopped thread preserves children and rejects running threads', async () => {
  const { manager, session, root } = await setup();
  const child = manager.create('codex', root, root, 'Child', session.id);
  session.status = 'running';
  assert.throws(() => manager.remove(session.id), /Stop this thread/);
  session.status = 'completed';
  manager.remove(session.id);
  assert.equal(manager.sessions.includes(session), false);
  assert.equal(child.parentId, undefined);
  manager.dispose();
});
