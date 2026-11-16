import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeAuth, parseCodexAuth } from '../../../src/providers/auth-status';

const run = (code: number | null, stdout: string, stderr = '') => ({ code, stdout, stderr });

test('Claude: signed in keeps only the method and plan, never the account details', () => {
  const auth = parseClaudeAuth(
    run(
      0,
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        subscriptionType: 'pro',
        email: 'someone@example.com',
        orgId: 'org-1',
      }),
    ),
  );
  assert.deepEqual(auth, { state: 'signedIn', method: 'Claude account', plan: 'Pro' });
});

test('Claude: signed out is reported with exit 1 and still parsed', () => {
  const out = JSON.stringify({ loggedIn: false, authMethod: 'none', loginExpiresAt: null });
  assert.deepEqual(parseClaudeAuth(run(1, out)), { state: 'signedOut' });
});

test('Claude: anything unexpected is unknown, never signed out', () => {
  assert.deepEqual(parseClaudeAuth(run(1, 'error: unknown command auth')), { state: 'unknown' });
  assert.deepEqual(parseClaudeAuth(run(0, '{"something":1}')), { state: 'unknown' });
  assert.deepEqual(parseClaudeAuth(run(0, 'null')), { state: 'unknown' });
});

test('Codex: logged in names the method', () => {
  assert.deepEqual(parseCodexAuth(run(0, 'Logged in using ChatGPT\n')), {
    state: 'signedIn',
    method: 'ChatGPT',
  });
  assert.deepEqual(parseCodexAuth(run(0, 'Logged in using an API key - sk-***\n')), {
    state: 'signedIn',
    method: 'API key',
  });
});

test('Codex: "Not logged in" is signed out; other failures are unknown', () => {
  assert.deepEqual(parseCodexAuth(run(1, '', 'Not logged in\n')), { state: 'signedOut' });
  assert.deepEqual(parseCodexAuth(run(2, '', 'error: unrecognized subcommand')), {
    state: 'unknown',
  });
  assert.deepEqual(parseCodexAuth(run(0, 'something else')), { state: 'unknown' });
});
