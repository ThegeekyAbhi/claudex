import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// Exercises the real host handler with fake VS Code settings and terminals. No provider runs.
async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'claudex-profile-'));
  let settings: any[] = [];
  let failSave = false;
  let cancelled = false;
  const terminals: any[] = [];
  const stub = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    workspace: {
      isTrusted: false,
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) => fallback,
        inspect: () => ({ globalValue: settings }),
        update: async (_key: string, value: any[]) => {
          if (failSave) throw new Error('Settings are read-only.');
          settings = value;
        },
      }),
    },
    window: {
      showOpenDialog: async () => (cancelled ? undefined : [{ fsPath: folder }]),
      createTerminal: (options: any) => {
        terminals.push(options);
        return { show() {} };
      },
    },
  };
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export { ProfilesHandlers } from './src/extension/handlers/profiles';
      export { setProfiles, parseProfileSettings, BUILTIN_PROFILES, actionSchema } from './src/shared/model';
    `,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'vscode-stub',
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'module.exports = globalThis.vscodeStub;',
          }));
        },
      },
    ],
  });
  const module = { exports: {} as any };
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    vscodeStub: stub,
    process,
  });
  const api = module.exports;
  const agents = {
    profiles: [],
    suggestions: [{ provider: 'claude', path: folder }],
    problems: [],
  };
  function refresh() {
    api.setProfiles([
      ...api.BUILTIN_PROFILES.map((item: any) => ({ ...item, status: 'ready' })),
      ...api
        .parseProfileSettings(settings)
        .profiles.map((item: any) => ({ ...item, status: 'ready' })),
    ]);
  }
  refresh();
  const host = new api.ProfilesHandlers({
    agents,
    loadAgents: async () => refresh(),
    loadCatalog: async () => {},
    sessions: { sessions: [] },
    skillLoads: new Map(),
  });
  const replies: any[] = [];
  const surface = {
    webview: {
      postMessage: async (value: any) => {
        replies.push(value);
      },
    },
  };
  let count = 0;
  async function request(value: any, target = surface) {
    const requestId = `request-${++count}`;
    const action = api.actionSchema.parse({ type: 'profileRequest', requestId, request: value });
    await host.handlers().profileRequest(action, target);
    return replies.find((item) => item.requestId === requestId);
  }
  return {
    request,
    folder,
    terminals,
    settings: () => settings,
    fail: (value: boolean) => {
      failSave = value;
    },
    cancel: () => {
      cancelled = true;
    },
    api,
    surface,
  };
}

test('profile creation validates folders, saves names, and preserves the handle on rename', async () => {
  const ctx = await fixture();
  const create = {
    operation: 'create',
    provider: 'claude',
    id: 'work',
    name: 'Work',
    folder: { kind: 'suggested', path: ctx.folder },
  };
  const forged = await ctx.request({
    ...create,
    folder: { kind: 'suggested', path: '/unapproved' },
  });
  assert.match(forged.error, /no longer available/);
  ctx.fail(true);
  assert.match((await ctx.request(create)).error, /read-only/);
  assert.equal(ctx.settings().length, 0);
  ctx.fail(false);
  assert.equal((await ctx.request(create)).id, 'work');
  assert.equal(ctx.settings().length, 1);
  assert.match((await ctx.request(create)).error, /already used/);
  await ctx.request({ operation: 'rename', id: 'work', name: 'Personal' });
  assert.equal(ctx.settings()[0].name, 'Personal');
  assert.equal(ctx.settings()[0].id, 'work');
  assert.equal(ctx.settings()[0].configDir, ctx.folder);
  assert.equal(ctx.terminals.length, 0, 'saving an account never initiates login');
  assert.match(
    (await ctx.request({ operation: 'remove', id: 'claude' })).error,
    /cannot be removed/,
  );
  await ctx.request({ operation: 'remove', id: 'work' });
  assert.equal(ctx.settings().length, 0);
});

test('picked account folders are scoped to their requesting webview and cancellation is explicit', async () => {
  const ctx = await fixture();
  const pick = await ctx.request({ operation: 'pickFolder' });
  assert.equal(pick.folder, ctx.folder);
  assert.ok(pick.token);
  const value = {
    operation: 'create',
    provider: 'codex',
    id: 'work',
    name: 'Work',
    folder: { kind: 'picked', token: pick.token },
  };
  const other = { webview: ctx.surface.webview };
  assert.match((await ctx.request(value, other)).error, /Choose the account folder again/);
  assert.equal((await ctx.request(value)).id, 'work');
  assert.equal((await ctx.request({ operation: 'signIn', id: 'work' })).error, undefined);
  assert.equal(ctx.terminals.length, 1);
  assert.deepEqual(Array.from(ctx.terminals[0].shellArgs), ['login']);
  assert.equal(ctx.terminals[0].env.CODEX_HOME, ctx.folder);
  ctx.cancel();
  assert.equal((await ctx.request({ operation: 'pickFolder' })).cancelled, true);
});

test('profile messages reject malformed names, handles and folder sources', async () => {
  const { api } = await fixture();
  const create = {
    operation: 'create',
    provider: 'claude',
    id: 'work',
    name: 'Work',
    folder: { kind: 'new' },
  };
  for (const request of [
    { ...create, id: '../escape' },
    { ...create, name: ' ' },
    { ...create, name: 'x'.repeat(61) },
    { ...create, folder: { kind: 'arbitrary', path: '/tmp' } },
  ])
    assert.equal(
      api.actionSchema.safeParse({ type: 'profileRequest', requestId: 'x', request }).success,
      false,
    );
});
