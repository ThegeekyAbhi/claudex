import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  stopPreview,
  waitForPreview,
  withUIResources,
} from '../../../../scripts/ui-check/resources';

function previewProcess() {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const signals: (NodeJS.Signals | undefined)[] = [];
  const preview = Object.assign(emitter, {
    stdout,
    pid: 1,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal?: NodeJS.Signals) {
      signals.push(signal);
      queueMicrotask(() => {
        preview.signalCode = signal ?? 'SIGTERM';
        emitter.emit('exit', null, preview.signalCode);
      });
      return true;
    },
  });
  return { preview: preview as unknown as ChildProcess, stdout, signals };
}

test('preview readiness checks the listening announcement and removes listeners', async () => {
  const { preview, stdout } = previewProcess();
  let ready = false;
  const waiting = waitForPreview(preview).then(() => {
    ready = true;
  });
  stdout.emit('data', Buffer.from('unrelated build output'));
  await Promise.resolve();
  assert.equal(ready, false);
  stdout.emit('data', 'Design preview: http://127.0.0.1:');
  stdout.emit('data', '4173\n');
  await waiting;
  assert.equal(ready, true);
  assert.equal(stdout.listenerCount('data'), 0);
  assert.equal(preview.listenerCount('exit'), 0);
  assert.equal(preview.listenerCount('error'), 0);
});

test('preview readiness has a deadline and removes its listeners', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { preview, stdout } = previewProcess();
  const waiting = assert.rejects(waitForPreview(preview, 100), /within 100 ms/);
  t.mock.timers.tick(100);
  await waiting;
  assert.equal(stdout.listenerCount('data'), 0);
  assert.equal(preview.listenerCount('exit'), 0);
});

for (const failure of ['readiness', 'launch', 'page', 'output', 'run', 'close'] as const) {
  test(`UI resources clean up after ${failure} failure`, async () => {
    const { preview, signals } = previewProcess();
    let closed = 0;
    let stopped = 0;
    const fail = (stage: string) => {
      if (stage === failure) throw new Error(`${stage} failed`);
    };
    const browser = {
      close: async () => {
        closed++;
        fail('close');
      },
    };
    await assert.rejects(
      withUIResources({
        startPreview: () => preview,
        waitForPreview: async () => fail('readiness'),
        stopPreview: async (child) => {
          stopped++;
          await stopPreview(child);
        },
        launchBrowser: async () => {
          fail('launch');
          return browser;
        },
        createPage: async () => {
          fail('page');
          return {};
        },
        prepareOutput: async () => fail('output'),
        run: async () => fail('run'),
        reportFailure: async () => {},
      }),
      new RegExp(`${failure} failed`),
    );
    assert.equal(stopped, 1);
    assert.deepEqual(signals, ['SIGTERM']);
    assert.equal(closed, ['readiness', 'launch'].includes(failure) ? 0 : 1);
    assert.equal(preview.listenerCount('exit'), 0);
  });
}

test('a real readiness timeout still terminates the acquired preview', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { preview, signals } = previewProcess();
  const waiting = assert.rejects(
    withUIResources({
      startPreview: () => preview,
      waitForPreview: (child) => waitForPreview(child, 100),
      stopPreview,
      launchBrowser: async () => assert.fail('must not launch'),
      createPage: async () => assert.fail('must not create page'),
      prepareOutput: async () => {},
      run: async () => assert.fail('must not run'),
      reportFailure: async () => {},
    }),
    /within 100 ms/,
  );
  t.mock.timers.tick(100);
  await waiting;
  assert.deepEqual(signals, ['SIGTERM']);
});

test('preview shutdown escalates and waits for the child exit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { preview } = previewProcess();
  const signals: (NodeJS.Signals | number | undefined)[] = [];
  preview.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGKILL') preview.emit('exit', null, signal);
    return true;
  };
  const stopping = stopPreview(preview, 100);
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(100);
  await stopping;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(preview.listenerCount('exit'), 0);
});
