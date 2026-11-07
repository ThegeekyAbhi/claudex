import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeAgent } from '../../../src/providers/claude/adapter';
import { CodexAgent } from '../../../src/providers/codex/adapter';
import { providerRegistry } from '../../../src/providers/registry';
import type { EventSink, Session } from '../../../src/shared/model';

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

test('registry constructs the registered adapters without starting a provider', () => {
  const thread = session();
  let emitted = false;
  const emit: EventSink = () => {
    emitted = true;
  };
  const claude = providerRegistry.claude(thread, { executable: 'unused' }, emit, {
    skills: () => [],
  });
  const codex = providerRegistry.codex(
    { ...thread, provider: 'codex' },
    { executable: 'unused' },
    emit,
    { skills: () => [] },
  );
  assert.ok(claude instanceof ClaudeAgent);
  assert.ok(codex instanceof CodexAgent);
  claude.dispose();
  codex.dispose();
  assert.equal(emitted, false);
});
