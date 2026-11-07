import assert from 'node:assert/strict';
import test from 'node:test';
import { Sessions } from '../../../../src/application/sessions/session-manager';
import type { Message } from '../../../../src/shared/model';

const long = (count: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: 'assistant' as const,
    text: 'word '.repeat(200),
  }));

test('sending reaches the provider without waiting on anything else', async () => {
  let reached = 0;
  const manager = new Sessions('/nonexistent', () => ({
    send: async () => {
      reached = performance.now();
    },
    interrupt: async () => {},
    dispose() {},
  }));
  const session = manager.create('codex', '/x', '/x', 'T');
  session.messages.push(...long(5000));
  const start = performance.now();
  await manager.send(session.id, 'hi');
  const overhead = reached - start;
  await manager.dispose().catch(() => {});
  assert.ok(overhead < 50, `took ${overhead.toFixed(1)} ms`);
});
