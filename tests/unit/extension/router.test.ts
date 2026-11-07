import assert from 'node:assert/strict';
import test from 'node:test';
import { routeAction } from '../../../src/extension/router';
import type { Surface } from '../../../src/extension/surfaces';
import { actionSchema } from '../../../src/shared/model';
import { testRoutes as routes } from '../../fixtures/host-route-fixture';

const surface = { kind: 'view', ready: false } as Surface;

test('host router dispatches the parsed action and originating surface after trust', async () => {
  const calls: unknown[] = [];
  await routeAction(
    { type: 'send', id: 'thread', text: '  hello  ', extra: 'discarded by the schema' },
    surface,
    routes({
      requireTrust: () => {
        calls.push('trust');
      },
      workspace: {
        send: (action, origin) => {
          calls.push(action, origin);
        },
        pin: () => assert.fail('wrong handler'),
      },
    }),
  );
  assert.deepEqual(calls, ['trust', { type: 'send', id: 'thread', text: 'hello' }, surface]);
});

test('host router rejects invalid and unknown messages with the existing schema error', async () => {
  for (const raw of [null, {}, { type: 'unknown' }, { type: 'pin', id: 'thread', pinned: 'yes' }]) {
    const parsed = actionSchema.safeParse(raw);
    assert.equal(parsed.success, false);
    assert.ok(parsed.error);
    await assert.rejects(
      async () =>
        routeAction(
          raw,
          surface,
          routes({ requireTrust: () => assert.fail('validation ran too late') }),
        ),
      (error: Error) => error.message === parsed.error.message,
    );
  }
});

test('host router keeps surface and personal settings actions outside workspace trust', async () => {
  const calls: string[] = [];
  const registry = routes({
    unrestricted: {
      ready: () => {
        calls.push('ready');
      },
      setGuide: (action) => {
        calls.push(action.guide);
      },
    },
    requireTrust: () => assert.fail('personal action required trust'),
  });
  await routeAction({ type: 'ready' }, surface, registry);
  await routeAction(
    { type: 'setGuide', guide: 'guidedPlanning', enabled: false },
    surface,
    registry,
  );
  assert.deepEqual(calls, ['ready', 'guidedPlanning']);
});

test('host router awaits profile actions without requiring workspace trust', async () => {
  const calls: string[] = [];
  await routeAction(
    { type: 'refreshAgents' },
    surface,
    routes({
      profiles: {
        refreshAgents: async () => {
          calls.push('profiles');
          await Promise.resolve();
          calls.push('done');
        },
      },
      requireTrust: () => assert.fail('profile action required trust'),
    }),
  );
  assert.deepEqual(calls, ['profiles', 'done']);
});

test('host router preserves the profile dispatch boundary before workspace trust', async () => {
  const calls: string[] = [];
  const pending = routeAction(
    { type: 'compose' },
    surface,
    routes({
      requireTrust: () => {
        calls.push('trust');
      },
      workspace: {
        compose: () => {
          calls.push('compose');
        },
      },
    }),
  );
  calls.push('received');
  await pending;
  assert.deepEqual(calls, ['received', 'trust', 'compose']);
});

test('host router stops before dispatch when workspace trust fails', async () => {
  await assert.rejects(
    routeAction(
      { type: 'compose' },
      surface,
      routes({
        requireTrust: () => {
          throw new Error('untrusted');
        },
        workspace: { compose: () => assert.fail('dispatched without trust') },
      }),
    ),
    /untrusted/,
  );
});
