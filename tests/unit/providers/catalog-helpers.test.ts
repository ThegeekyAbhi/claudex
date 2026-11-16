import assert from 'node:assert/strict';
import test from 'node:test';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { withClaudeCatalog } from '../../../src/providers/claude/catalog-probe';
import { initializeCodex } from '../../../src/providers/codex/handshake';

function deferred<T>() {
  let resolve = (_value: T) => {};
  let reject = (_reason: unknown) => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('Codex handshake awaits initialization before its notification and preserves explicit capabilities', async () => {
  for (const experimentalApi of [false, true]) {
    const response = deferred<void>();
    const messages: unknown[] = [];
    const ready = initializeCodex(
      {
        request: async (method, params) => {
          messages.push({ method, params });
          return response.promise;
        },
        write: (message) => {
          messages.push(message);
        },
      },
      { experimentalApi },
    );
    assert.deepEqual(messages, [
      {
        method: 'initialize',
        params: {
          clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.6.0' },
          capabilities: { experimentalApi },
        },
      },
    ]);
    response.resolve();
    await ready;
    assert.deepEqual(messages[1], { method: 'initialized' });
  }
});

test('a failed Codex handshake does not notify initialized or take over caller disposal', async () => {
  let writes = 0;
  await assert.rejects(
    initializeCodex(
      {
        request: async () => {
          throw new Error('closed');
        },
        write: () => {
          writes++;
        },
      },
      { experimentalApi: true },
    ),
    /closed/,
  );
  assert.equal(writes, 0);
});

function probeFixture() {
  let closes = 0;
  let input: { prompt: AsyncIterable<never>; options: Options } | undefined;
  const work = deferred<never[]>();
  const load = async () => (value: NonNullable<typeof input>) => {
    input = value;
    return {
      supportedModels: () => work.promise,
      supportedCommands: () => work.promise,
      close: () => {
        closes++;
      },
    };
  };
  return { load, work, input: () => input, closes: () => closes };
}

const options = {
  executable: '/installed/claude',
  cwd: '/project',
  settingSources: [] as [],
  timeoutMs: 500,
  timeoutMessage: 'metadata timeout',
};

test('Claude probe uses explicit settings, releases empty input, and closes on success or rejection', async () => {
  for (const fail of [false, true]) {
    const run = probeFixture();
    const result = withClaudeCatalog(
      { ...options, settingSources: ['user', 'project', 'local'] },
      (active) => active.supportedCommands(),
      run.load,
    );
    await Promise.resolve();
    const input = run.input();
    assert.ok(input);
    assert.deepEqual(input.options.settingSources, ['user', 'project', 'local']);
    assert.equal(input.options.pathToClaudeCodeExecutable, '/installed/claude');
    const pendingInput = input.prompt[Symbol.asyncIterator]().next();
    if (fail) run.work.reject(new Error('query failed'));
    else run.work.resolve([]);
    if (fail) await assert.rejects(result, /query failed/);
    else assert.deepEqual(await result, []);
    assert.equal((await pendingInput).done, true);
    assert.equal(run.closes(), 1);
  }
});

test('Claude probe timeout and abort settle work and close without waiting for SDK response', async () => {
  for (const reason of ['timeout', 'abort']) {
    const run = probeFixture();
    const controller = new AbortController();
    const keepAlive = setTimeout(() => {}, 100);
    try {
      const result = withClaudeCatalog(
        { ...options, timeoutMs: 5, signal: controller.signal },
        (active) => active.supportedModels(),
        run.load,
      );
      await Promise.resolve();
      if (reason === 'abort') controller.abort(new Error('cancel metadata'));
      await assert.rejects(result, reason === 'abort' ? /cancel metadata/ : /metadata timeout/);
      assert.equal(run.closes(), 1);
      assert.equal((await run.input()?.prompt[Symbol.asyncIterator]().next())?.done, true);
    } finally {
      clearTimeout(keepAlive);
    }
  }
});

test('Claude probe never acquires after an abort before or during module loading', async () => {
  for (const before of [true, false]) {
    const run = probeFixture();
    const controller = new AbortController();
    const loaded = deferred<Awaited<ReturnType<typeof run.load>>>();
    if (before) controller.abort();
    const result = withClaudeCatalog(
      { ...options, signal: controller.signal },
      (active) => active.supportedModels(),
      () => loaded.promise,
    );
    controller.abort();
    loaded.resolve(await run.load());
    await assert.rejects(result, /abort/i);
    assert.equal(run.input(), undefined);
    assert.equal(run.closes(), 0);
  }
});

test('Claude probe clears its deadline after success', async (context) => {
  const cleared: ReturnType<typeof setTimeout>[] = [];
  const clear = globalThis.clearTimeout;
  context.mock.method(globalThis, 'clearTimeout', (timer: ReturnType<typeof setTimeout>) => {
    cleared.push(timer);
    clear(timer);
  });
  const run = probeFixture();
  const result = withClaudeCatalog(options, (active) => active.supportedModels(), run.load);
  await Promise.resolve();
  run.work.resolve([]);
  await result;
  assert.equal(cleared.length, 1);
  assert.ok(cleared[0]);
});
