import assert from 'node:assert/strict';
import test from 'node:test';
import {
  needsSignIn,
  noAgentInstalled,
  onboardingStage,
  type SetupRow,
  setupRows,
} from '../../../../src/shared/domain/onboarding';
import type { AgentSetup } from '../../../../src/shared/domain/session';

const setup = (profiles: AgentSetup['profiles']): AgentSetup => ({
  profiles,
  problems: [],
  suggestions: [],
});

test('setup lists both built-in agents as checking until the host has looked', () => {
  const rows = setupRows(undefined);
  assert.deepEqual(
    rows.map((row) => [row.id, row.label, row.state]),
    [
      ['claude', 'Claude Code', 'checking'],
      ['codex', 'Codex', 'checking'],
    ],
  );
  assert.equal(noAgentInstalled(rows), false);
});

test('setup reports installed agents and why others cannot run, then added profiles', () => {
  const rows = setupRows(
    setup([
      {
        id: 'claude',
        label: 'Claude',
        provider: 'claude',
        builtin: true,
        status: 'ready',
        version: '2.1.0',
      },
      {
        id: 'codex',
        label: 'Codex',
        provider: 'codex',
        builtin: true,
        status: 'missingCli',
        problem: 'codex was not found on PATH.',
      },
      { id: 'work', label: 'Work', provider: 'claude', homeDir: '/tmp/x', status: 'missingFolder' },
    ]),
  );
  assert.deepEqual(rows, [
    {
      id: 'claude',
      label: 'Claude Code',
      provider: 'claude',
      state: 'installed',
      version: '2.1.0',
    },
    {
      id: 'codex',
      label: 'Codex',
      provider: 'codex',
      state: 'missingCli',
      problem: 'codex was not found on PATH.',
    },
    { id: 'work', label: 'Work', provider: 'claude', state: 'missingFolder' },
  ]);
  assert.equal(noAgentInstalled(rows), false);
});

test('sign-in comes only from what the CLI reported, and only for installed agents', () => {
  const rows = setupRows(
    setup([
      {
        id: 'claude',
        label: 'Claude',
        provider: 'claude',
        builtin: true,
        status: 'ready',
        auth: { state: 'signedIn', method: 'Claude account', plan: 'Pro' },
      },
      { id: 'codex', label: 'Codex', provider: 'codex', builtin: true, status: 'ready' },
      {
        id: 'work',
        label: 'Work',
        provider: 'claude',
        status: 'missingFolder',
        auth: { state: 'signedIn' },
      },
    ]),
  );
  assert.deepEqual(rows[0].auth, { state: 'signedIn', method: 'Claude account', plan: 'Pro' });
  assert.equal(rows[1].auth, undefined, 'not asked yet is not signed out');
  assert.equal(rows[2].auth, undefined, 'a profile that cannot run has no sign-in state');
  assert.equal(needsSignIn(rows[1]), false);
});

const row = (id: string, auth?: SetupRow['auth']): SetupRow => ({
  id,
  label: id,
  provider: 'claude',
  state: 'installed',
  ...(auth ? { auth } : {}),
});

test('signed-in users go straight to the greeting, with no setup', () => {
  const rows = [row('claude', { state: 'signedIn' }), row('work', { state: 'signedIn' })];
  assert.equal(onboardingStage({ threads: 0, dismissed: false, rows }), 'ready');
  assert.equal(onboardingStage({ threads: 3, dismissed: false, rows }), 'hidden');
});

test('sign-in shows only when every installed agent says it is signed out', () => {
  const out = row('claude', { state: 'signedOut' });
  assert.equal(onboardingStage({ threads: 0, dismissed: false, rows: [out] }), 'signIn');
  assert.equal(
    onboardingStage({ threads: 0, dismissed: false, rows: [out, row('b', { state: 'signedIn' })] }),
    'ready',
  );
  // Unknown or not yet asked is never treated as signed out.
  assert.equal(
    onboardingStage({ threads: 0, dismissed: false, rows: [out, row('b', { state: 'unknown' })] }),
    'ready',
  );
  assert.equal(onboardingStage({ threads: 0, dismissed: false, rows: [out, row('b')] }), 'ready');
  // Skipping it moves on to the greeting.
  assert.equal(onboardingStage({ threads: 0, dismissed: true, rows: [out] }), 'ready');
});

test('install shows while no agent is installed, even after dismissing or with threads', () => {
  const none: SetupRow[] = [
    { id: 'claude', label: 'Claude Code', provider: 'claude', state: 'missingCli' },
    { id: 'codex', label: 'Codex', provider: 'codex', state: 'missingCli' },
  ];
  assert.equal(noAgentInstalled(none), true);
  assert.equal(onboardingStage({ threads: 5, dismissed: true, rows: none }), 'install');
  // Still checking is not the same as missing, so it does not force setup.
  const pending: SetupRow[] = [{ ...none[0] }, { ...none[1], state: 'checking' }];
  assert.equal(noAgentInstalled(pending), false);
  assert.equal(onboardingStage({ threads: 0, dismissed: false, rows: pending }), 'ready');
  assert.equal(onboardingStage({ threads: 5, dismissed: true, rows: pending }), 'hidden');
});
