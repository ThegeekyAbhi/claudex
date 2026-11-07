import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentFactory } from '../../../../src/application/sessions/session-manager';
import { type ProviderFactory, providerRegistry } from '../../../../src/providers/registry';
import { ImageStore } from '../../../../src/providers/shared/image-store';
import type { Delegate, EventSink, Session, SkillRequest } from '../../../../src/shared/model';

function session(): Session {
  return {
    id: 'local-session',
    provider: 'claude',
    title: 'A thread',
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

test('factory dispatches through the registry with profile environment and lazy dependencies', (t) => {
  const thread = { ...session(), provider: 'codex' as const, profileId: 'codex-work' };
  const launcher = { executable: 'custom-codex', env: { CODEX_HOME: '/profile' } };
  const emit: EventSink = () => {};
  const delegate: Delegate = async () => ({ sessionId: 'child', status: 'failed', text: '' });
  const images = new ImageStore('/unused');
  const skills: SkillRequest[] = [];
  let skillReads = 0;
  const agent = { send: async () => {}, interrupt: async () => {}, dispose() {} };
  const registered = t.mock.method(
    providerRegistry,
    'codex',
    (...[actual, resolved, sink, deps]: Parameters<ProviderFactory>) => {
      assert.equal(actual, thread);
      assert.equal(resolved, launcher);
      assert.equal(sink, emit);
      assert.equal(deps.delegate, delegate);
      assert.equal(deps.images, images);
      assert.equal(skillReads, 0);
      assert.equal(deps.skills(), skills);
      assert.equal(skillReads, 1);
      return agent;
    },
  );
  const factory = createAgentFactory(
    (provider, profileId) => {
      assert.equal(provider, 'codex');
      assert.equal(profileId, 'codex-work');
      return launcher;
    },
    images,
    (actual) => {
      assert.equal(actual, thread);
      skillReads++;
      return skills;
    },
  );
  assert.equal(factory(thread, emit, delegate), agent);
  assert.equal(registered.mock.callCount(), 1);
});

test('factory normalizes string launchers and keeps missing optional dependencies unset', (t) => {
  const registered = t.mock.method(
    providerRegistry,
    'claude',
    (...[_session, launcher, _emit, deps]: Parameters<ProviderFactory>) => {
      assert.deepEqual(launcher, { executable: 'claude-wrapper' });
      assert.equal(deps.delegate, undefined);
      assert.equal(deps.images, undefined);
      assert.deepEqual(deps.skills(), []);
      return { send: async () => {}, interrupt: async () => {}, dispose() {} };
    },
  );
  createAgentFactory(() => 'claude-wrapper')(session(), () => {});
  assert.equal(registered.mock.callCount(), 1);
});
