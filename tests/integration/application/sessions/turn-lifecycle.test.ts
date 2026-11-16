import assert from 'node:assert/strict';
import test from 'node:test';
import { Sessions } from '../../../../src/application/sessions/session-manager';
import type { Message } from '../../../../src/shared/model';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const long = (count: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: 'assistant' as const,
    text: 'word '.repeat(200),
  }));

test(
  'provider dispatch does not await an outstanding persistence flush',
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const background = deferred();
    const dispatched = deferred();
    let backgroundSettled = false;
    let flushes = 0;
    const manager = new Sessions(
      '/nonexistent',
      () => ({
        send: async () => {
          assert.equal(
            backgroundSettled,
            false,
            'provider dispatch precedes persistence completion',
          );
          dispatched.resolve();
        },
        interrupt: async () => {},
        dispose() {},
      }),
      1,
    );
    manager.flush = async () => {
      flushes++;
      await background.promise;
    };
    t.after(async () => {
      background.resolve();
      await manager.dispose();
    });
    const session = manager.create('codex', '/nonexistent', '/nonexistent', 'T');
    session.messages.push(...long(5000));
    t.mock.timers.tick(1);
    assert.equal(flushes, 1, 'scheduled background persistence is already pending');
    const sending = manager.send(session.id, 'hi');
    await Promise.race([
      dispatched.promise,
      sending.then(() => assert.fail('send settled without dispatching')),
    ]);
    backgroundSettled = true;
    background.resolve();
    await sending;
  },
);
