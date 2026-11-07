import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionPersistence } from '../../../../src/application/sessions/session-persistence';

test('scheduled save errors reach the supplied error callback', async (t) => {
  const persistence = new SessionPersistence({ storage: '/unused', sessions: [] });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failure = new Error('disk full');
  const errors: unknown[] = [];
  persistence.scheduleSave({
    delayMs: 10,
    flush: async () => {
      throw failure;
    },
    onError: (error) => errors.push(error),
  });
  t.mock.timers.tick(10);
  await Promise.resolve();
  assert.deepEqual(errors, [failure]);
});
