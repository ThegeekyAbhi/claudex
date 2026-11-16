import assert from 'node:assert/strict';
import test from 'node:test';
import { SideQuestionsHandlers } from '../../../../src/extension/handlers/side-questions';
import type { Surface } from '../../../../src/extension/surfaces';
import type { SideQuestion } from '../../../../src/providers/side-question';
import type { Session } from '../../../../src/shared/model';

const session = {
  id: 'thread',
  provider: 'codex',
  title: 'Task',
  cwd: '/project',
  workspace: '/project',
  status: 'idle',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
} as Session;

function fixture(options: { launcherFails?: boolean; agentMissing?: boolean } = {}) {
  const posted: any[] = [];
  const surface = { webview: { postMessage: async (message: unknown) => posted.push(message) } };
  const pending: (() => void)[] = [];
  const asked: SideQuestion[] = [];
  const ask = async (question: SideQuestion) => {
    asked.push(question);
    question.onActivity?.('Read src/a.ts');
    question.onText('Yes.');
    await new Promise<void>((resolve) => pending.push(resolve));
  };
  const handlers = new SideQuestionsHandlers(
    {
      sessions: { get: () => session },
      requireAgent: () => {
        if (options.agentMissing) throw new Error('There is no agent “codex-2”.');
        return {} as any;
      },
      launcherFor: () => {
        if (options.launcherFails) throw new Error('Codex isn’t installed.');
        return { executable: 'codex' };
      },
      output: { appendLine: () => {} },
    },
    { claude: ask, codex: ask },
  );
  const ask1 = (requestId: string) =>
    handlers
      .handlers()
      .sideQuestion(
        { type: 'sideQuestion', id: session.id, requestId, text: 'q' },
        surface as unknown as Surface,
      );
  const settle = async () => {
    for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
  };
  const finish = () => {
    for (const resolve of pending.splice(0)) resolve();
  };
  return { posted, ask: ask1, settle, finish, asked, handlers };
}

const terminal = (posted: any[], requestId: string) =>
  posted.filter((message) => message.requestId === requestId && message.done);

test('a side question streams text and what it looked at, then ends once', async () => {
  const run = fixture();
  await run.ask('one');
  await run.settle();
  run.finish();
  await run.settle();
  assert.deepEqual(
    run.posted.map(({ type, requestId, ...rest }) => rest),
    [{ activity: 'Read src/a.ts' }, { delta: 'Yes.' }, { done: true }],
  );
});

test('a side question over the limit ends with its own error instead of answering forever', async () => {
  const run = fixture();
  await Promise.all(['a', 'b', 'c', 'd'].map((id) => run.ask(id)));
  await run.settle();
  assert.deepEqual(terminal(run.posted, 'd'), [
    {
      type: 'sideAnswer',
      requestId: 'd',
      done: true,
      error: 'Wait for a side question to finish before asking another.',
    },
  ]);
  assert.equal(run.asked.length, 3);
  // The refused one never took a slot: once the others end, a new one is answered.
  run.finish();
  await run.settle();
  await run.ask('e');
  await run.settle();
  assert.equal(run.asked.length, 4);
  run.finish();
  await run.settle();
  assert.equal(terminal(run.posted, 'e').length, 1);
});

test('an unavailable agent or CLI ends the request with its reason and frees its slot', async () => {
  for (const options of [{ agentMissing: true }, { launcherFails: true }]) {
    const run = fixture(options);
    for (const id of ['a', 'b', 'c', 'd']) await run.ask(id);
    await run.settle();
    for (const id of ['a', 'b', 'c', 'd']) {
      const [end] = terminal(run.posted, id);
      assert.match(end.error, /no agent|isn’t installed/);
    }
    assert.equal(run.asked.length, 0);
  }
});

test('a stopped side question ends without an error', async () => {
  const run = fixture();
  await run.ask('a');
  await run.settle();
  await run.handlers
    .handlers()
    .stopSideQuestion({ type: 'stopSideQuestion', requestId: 'a' }, {} as Surface);
  run.finish();
  await run.settle();
  assert.deepEqual(terminal(run.posted, 'a'), [{ type: 'sideAnswer', requestId: 'a', done: true }]);
});
