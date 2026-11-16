import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCopy } from '../../../../src/webview/app/bridge';

test('copy results share one subscription and settle only their own pending request', () => {
  const previous = globalThis.window;
  const listeners = new Set<(event: MessageEvent) => void>();
  let registrations = 0;
  let callback: ((event: MessageEvent) => void) | undefined;
  Object.assign(globalThis, {
    window: {
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        registrations++;
        callback = listener;
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        listeners.delete(listener);
      },
    },
  });
  const originalUUID = crypto.randomUUID;
  let next = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
  const results: [number, boolean][] = [];
  const cancel: (() => void)[] = [];
  try {
    for (let index = 0; index < 100; index++)
      cancel.push(requestCopy('text', (result) => results.push([index, result.ok])));
    assert.equal(registrations, 1);
    assert.equal(listeners.size, 1);
    const deliver = (index: number, ok = true) =>
      callback?.({
        data: {
          type: 'copyResult',
          requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          ok,
        },
      } as MessageEvent);
    deliver(99, false);
    deliver(1);
    deliver(99);
    deliver(1000);
    cancel[1]?.();
    deliver(2);
    assert.deepEqual(results, [
      [98, false],
      [0, true],
    ]);
  } finally {
    for (const unsubscribe of cancel) unsubscribe();
    assert.equal(listeners.size, 0);
    crypto.randomUUID = originalUUID;
    Object.assign(globalThis, { window: previous });
  }
});
