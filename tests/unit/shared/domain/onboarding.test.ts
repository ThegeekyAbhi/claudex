import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noAgentInstalled,
  type SetupRow,
  setupRows,
  showSetupCard,
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

test('installed is never reported as signed in, since credentials are never read', () => {
  const states = setupRows(
    setup([{ id: 'claude', label: 'Claude', provider: 'claude', builtin: true, status: 'ready' }]),
  ).map((row) => row.state);
  assert.ok(!states.some((state) => /sign/i.test(state)));
});

test('the card shows until the first thread unless dismissed', () => {
  const ready: SetupRow[] = [
    { id: 'claude', label: 'Claude Code', provider: 'claude', state: 'installed' },
  ];
  assert.equal(showSetupCard({ threads: 0, dismissed: false, rows: ready }), true);
  assert.equal(showSetupCard({ threads: 0, dismissed: true, rows: ready }), false);
  assert.equal(showSetupCard({ threads: 3, dismissed: false, rows: ready }), false);
});

test('the card stays while no agent is installed, even after dismissing or with threads', () => {
  const none: SetupRow[] = [
    { id: 'claude', label: 'Claude Code', provider: 'claude', state: 'missingCli' },
    { id: 'codex', label: 'Codex', provider: 'codex', state: 'missingCli' },
  ];
  assert.equal(noAgentInstalled(none), true);
  assert.equal(showSetupCard({ threads: 5, dismissed: true, rows: none }), true);
  // Still checking is not the same as missing, so it does not force the card.
  const pending: SetupRow[] = [{ ...none[0] }, { ...none[1], state: 'checking' }];
  assert.equal(noAgentInstalled(pending), false);
  assert.equal(showSetupCard({ threads: 5, dismissed: true, rows: pending }), false);
});
