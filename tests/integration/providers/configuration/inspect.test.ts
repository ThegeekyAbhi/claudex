import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  configurationDeclarations,
  inspectConfiguration,
} from '../../../../src/providers/configuration/inspect';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'claudex-config-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'repo');
  const systemDirectory = path.join(base, 'system');
  await mkdir(path.join(cwd, '.git'), { recursive: true });
  async function write(file: string, text: string) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return { base, home, cwd, systemDirectory, write };
}
const secret = 'CANARY_PRIVATE_CREDENTIAL_ABC123';

test('Claude projects allowlisted declarations without credential values, commands, endpoints or header names', () => {
  const text = JSON.stringify({
    apiKey: secret,
    permissions: { defaultMode: 'plan', allow: [`Bash(${secret})`] },
    skillOverrides: { review: 'off', injected: secret },
    env: { GITHUB_TOKEN: secret },
    hooks: { SessionStart: [{ hooks: [{ command: `touch ${secret}` }] }] },
    mcpServers: {
      github: {
        url: `https://host/${secret}`,
        env: { MCP_KEY: secret },
        headers: { [secret]: secret },
      },
    },
  });
  const rows = configurationDeclarations('claude', text, 'json', 'user');
  assert.ok(!JSON.stringify(rows).includes(secret));
  assert.ok(rows.some((row) => row.key === 'skillOverrides.review' && row.value === 'off'));
  assert.ok(
    rows.some((row) => row.key === 'env.GITHUB_TOKEN' && row.value.includes('native provider')),
  );
  assert.ok(rows.some((row) => row.key === 'mcpServers.github.env.MCP_KEY'));
  assert.ok(
    !rows.some((row) => row.key.includes('hooks') || row.key.includes('permissions.allow')),
  );
});

test('Codex projects ordered skill selectors, flags and credential-reference names, skipping multiline secrets', () => {
  const rows = configurationDeclarations(
    'codex',
    `
api_key = '''${secret}\n[features]\nhooks = true'''
[features]
hooks = false
[skills.bundled]
enabled = false
[[skills.config]]
name = 'review'
enabled = false
[[skills.config]]
path = '/skills/review/SKILL.md'
enabled = true
[mcp_servers.github]
enabled = false
bearer_token_env_var = 'GITHUB_TOKEN'
http_headers = { authorization = '${secret}' }
[mcp_servers.github.env]
GITHUB_TOKEN = '${secret}'
`,
    'toml',
    'user',
  );
  assert.ok(!JSON.stringify(rows).includes(secret));
  assert.ok(rows.some((row) => row.key === 'features.hooks' && row.value === 'false'));
  assert.ok(
    rows.some(
      (row) =>
        row.key === 'mcp_servers.github.bearer_token_env_var' && row.value === 'GITHUB_TOKEN',
    ),
  );
  assert.equal(rows.filter((row) => row.category === 'skill').length, 2);
  assert.ok(rows.find((row) => row.value.startsWith('name: review'))?.value.endsWith('false'));
});

test('malformed, ambiguous or oversized projections fail without echoing input', () => {
  for (const text of [
    `{"disableAllHooks": false, "disableAllHooks": true, "secret": "${secret}"}`,
    `{"env": {"TOKEN": "${secret}\\q"}}`,
    `{"skillOverrides": {"a": "off"},`,
  ])
    assert.throws(
      () => configurationDeclarations('claude', text, 'json', 'user'),
      (error) => !String(error).includes(secret),
    );
  assert.throws(() =>
    configurationDeclarations('codex', '[features]\nhooks=true\nhooks=false', 'toml', 'user'),
  );
  assert.throws(
    () => configurationDeclarations('codex', `api_key='''${secret}`, 'toml', 'user'),
    (error) => !String(error).includes(secret),
  );
  assert.throws(() =>
    configurationDeclarations(
      'claude',
      JSON.stringify({
        env: Object.fromEntries(
          Array.from({ length: 1100 }, (_, index) => [`KEY_${index}`, secret]),
        ),
      }),
      'json',
      'user',
    ),
  );
});

test('inspection resolves ordinary local overrides, keeps managed declarations separate and never executes repository hooks', async (t) => {
  const f = await fixture(t);
  const marker = path.join(f.base, 'executed');
  await f.write(
    path.join(f.home, '.claude/settings.json'),
    JSON.stringify({ skillOverrides: { review: 'on' }, env: { TOKEN: secret } }),
  );
  await f.write(
    path.join(f.cwd, '.claude/settings.json'),
    JSON.stringify({
      skillOverrides: { review: 'name-only' },
      hooks: { SessionStart: [{ hooks: [{ command: `touch ${marker}` }] }] },
    }),
  );
  await f.write(
    path.join(f.cwd, '.claude/settings.local.json'),
    JSON.stringify({ skillOverrides: { review: 'off' } }),
  );
  await f.write(
    path.join(f.systemDirectory, 'managed-settings.json'),
    JSON.stringify({ disableSkillShellExecution: true }),
  );
  const inspection = await inspectConfiguration({ ...f, provider: 'claude' });
  const overrides = inspection.declarations.filter((row) => row.key === 'skillOverrides.review');
  assert.deepEqual(
    overrides.map((row) => [row.value, row.resolution]),
    [
      ['on', 'overridden'],
      ['name-only', 'overridden'],
      ['off', 'localWinner'],
    ],
  );
  assert.ok(
    inspection.declarations.some(
      (row) => row.key === 'disableSkillShellExecution' && row.resolution === 'constraint',
    ),
  );
  assert.ok(!JSON.stringify(inspection).includes(secret));
  await assert.rejects(access(marker));
  const nested = path.join(f.cwd, 'nested');
  await mkdir(nested);
  const nestedInspection = await inspectConfiguration({ ...f, provider: 'claude', cwd: nested });
  assert.ok(
    nestedInspection.sources.some(
      (source) => source.path === path.join(f.cwd, '.claude/settings.local.json'),
    ),
  );
});

test('Codex resolves root-to-cwd candidates, custom homes and policy constraints independently of native trust', async (t) => {
  const f = await fixture(t);
  const runtimeHome = path.join(f.home, 'work-codex');
  const cwd = path.join(f.cwd, 'service');
  await mkdir(cwd);
  await f.write(path.join(runtimeHome, 'config.toml'), '[features]\nhooks = true');
  await f.write(path.join(f.cwd, '.codex/config.toml'), '[features]\nhooks = false');
  await f.write(path.join(cwd, '.codex/config.toml'), '[features]\nhooks = true');
  await f.write(path.join(f.systemDirectory, 'requirements.toml'), '[features]\nhooks = false');
  const result = await inspectConfiguration({ ...f, cwd, runtimeHome, provider: 'codex' });
  assert.equal(result.declarations.filter((row) => row.resolution === 'constraint').length, 1);
  assert.ok(
    !result.declarations.some(
      (row) => row.key === 'features.hooks' && row.resolution === 'localWinner',
    ),
  );
  assert.ok(result.sources.filter((source) => source.status === 'partial').length >= 3);
  assert.ok(result.limitations.some((limit) => limit.includes('native trust')));
  assert.ok(!result.sources.some((source) => source.path.includes('.claude')));
});

test('linked, unreadable and malformed files remain unresolved; refresh observes external changes; abort stops scanning', async (t) => {
  const f = await fixture(t);
  await f.write(path.join(f.home, '.claude/settings.json'), '{"skillOverrides":{"review":"on"}}');
  const local = path.join(f.cwd, '.claude/settings.local.json');
  await f.write(local, `{"token":"${secret}", invalid}`);
  let result = await inspectConfiguration({ ...f, provider: 'claude' });
  assert.ok(result.sources.some((source) => source.status === 'unsupported'));
  assert.ok(!result.declarations.some((row) => row.resolution === 'localWinner'));
  await f.write(local, '{"skillOverrides":{"review":"off"}}');
  result = await inspectConfiguration({ ...f, provider: 'claude' });
  assert.ok(
    result.declarations.some((row) => row.value === 'off' && row.resolution === 'localWinner'),
  );
  await rm(local);
  await symlink(path.join(f.home, '.claude/settings.json'), local);
  result = await inspectConfiguration({ ...f, provider: 'claude' });
  assert.ok(result.sources.find((source) => source.path === local)?.status === 'unsupported');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspectConfiguration({ ...f, provider: 'claude', signal: controller.signal }),
  );
});

test('quoted dotted keys and values inside secrets cannot impersonate native configuration paths', () => {
  const json = JSON.stringify({
    'permissions.defaultMode': 'plan',
    sandbox_mode: 'workspace-write',
    token: { skillOverrides: { review: 'off' } },
  });
  assert.equal(configurationDeclarations('claude', json, 'json', 'user').length, 0);
  const toml = `
'features.hooks' = true
private = ["[features]", "hooks = true"]
private_table = { fake = "hooks = true", secret = "${secret}" }
[features]
hooks = false
`;
  const rows = configurationDeclarations('codex', toml, 'toml', 'user');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 'false');
  assert.ok(!JSON.stringify(rows).includes(secret));
});
