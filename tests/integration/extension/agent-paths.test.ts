import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  expandHome,
  launchProfile,
  profileHome,
  suggestFolders,
} from '../../../src/extension/agent-paths';
import type { AgentProfile } from '../../../src/shared/model';

const base = (provider: string) => `/bin/${provider}`;

test('a profile with its own folder gets that folder as its CLI home, and nothing else', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aw-profile-'));
  const claude: AgentProfile = {
    id: 'claude-work',
    label: 'Work',
    provider: 'claude',
    homeDir: home,
  };
  const codex: AgentProfile = {
    id: 'codex-client',
    label: 'Client',
    provider: 'codex',
    homeDir: home,
  };
  assert.deepEqual(launchProfile(claude, 'claude', claude.id, base), {
    executable: '/bin/claude',
    env: { CLAUDE_CONFIG_DIR: home },
  });
  assert.deepEqual(launchProfile(codex, 'codex', codex.id, base), {
    executable: '/bin/codex',
    env: { CODEX_HOME: home },
  });
  // The built-ins run exactly as the CLI does in a shell: no extra environment.
  const builtin: AgentProfile = {
    id: 'claude',
    label: 'Claude',
    provider: 'claude',
    builtin: true,
  };
  assert.deepEqual(launchProfile(builtin, 'claude', 'claude', base), { executable: '/bin/claude' });
});

test('a missing profile or folder fails instead of running as the default account', () => {
  assert.throws(() => launchProfile(undefined, 'claude', 'gone', base), /no agent profile “gone”/);
  const missing: AgentProfile = {
    id: 'claude-work',
    label: 'Work',
    provider: 'claude',
    homeDir: path.join(tmpdir(), 'aw-does-not-exist-', String(Date.now())),
  };
  assert.throws(() => launchProfile(missing, 'claude', missing.id, base), /doesn’t exist/);
  const codex: AgentProfile = { id: 'codex', label: 'Codex', provider: 'codex', builtin: true };
  assert.throws(() => launchProfile(codex, 'claude', 'codex', base), /runs codex, not claude/);
});

test('folders that look like another account are suggested, and used ones are not', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aw-home-'));
  await mkdir(path.join(home, '.claude-account2'));
  await writeFile(path.join(home, '.claude-account2', 'settings.json'), '{}');
  await mkdir(path.join(home, '.claude-work'));
  await writeFile(path.join(home, '.claude-work', '.claude.json'), '{}');
  await mkdir(path.join(home, '.codex-client'));
  await writeFile(path.join(home, '.codex-client', 'config.toml'), '');
  // Empty, or not an account folder: not suggested.
  await mkdir(path.join(home, '.claude-empty'));
  await mkdir(path.join(home, '.clauderc'));
  await writeFile(path.join(home, '.claude-file'), '');
  const used: AgentProfile = {
    id: 'claude-work',
    label: 'Work',
    provider: 'claude',
    homeDir: path.join(home, '.claude-work'),
  };
  assert.deepEqual(suggestFolders([used], home), [
    { provider: 'claude', path: '~/.claude-account2' },
    { provider: 'codex', path: '~/.codex-client' },
  ]);
  assert.equal(
    profileHome({ id: 'codex', label: 'Codex', provider: 'codex' }, home),
    path.join(home, '.codex'),
  );
  assert.equal(expandHome('~/.claude-x', home), path.join(home, '.claude-x'));
});
