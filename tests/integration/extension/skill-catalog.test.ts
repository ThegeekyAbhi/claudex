import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

async function fixture() {
  let nativeCalls = 0;
  const configurationCalls: string[] = [];
  let permission: string | undefined;
  const targets = new Map<object, string>();
  const native = {
    listClaudeSkills: async () => {
      nativeCalls++;
      return { skills: [{ name: 'review', enabled: true, evidence: 'native' }], problems: [] };
    },
    listCodexSkills: async () => {
      nativeCalls++;
      return { skills: [], problems: [] };
    },
    setCodexSkillEnabled: async () => {
      nativeCalls++;
    },
  };
  const stub = {
    env: {},
    workspace: { isTrusted: true },
    window: { showWarningMessage: async () => permission },
  };
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export { CatalogHandlers } from './src/extension/handlers/catalog';
      export { setProfiles, BUILTIN_PROFILES, actionSchema } from './src/shared/model';
    `,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'catalog-stubs',
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
          builder.onResolve({ filter: /application\/catalogs\/skill-catalog$/ }, () => ({
            path: 'native',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /providers\/configuration\/inspect$/ }, () => ({
            path: 'configuration',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /providers\/skill-files$/ }, () => ({
            path: 'files',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /^\.\.\/launcher$/ }, () => ({
            path: 'launcher',
            namespace: 'stub',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: `module.exports = globalThis.stubs[${JSON.stringify(args.path)}];`,
          }));
        },
      },
    ],
  });
  const module = { exports: {} as any };
  runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    process,
    AbortController,
    stubs: {
      vscode: stub,
      native,
      configuration: {
        inspectConfiguration: async ({ cwd, provider }: { cwd: string; provider: string }) => {
          configurationCalls.push(cwd);
          return {
            provider,
            cwd,
            observedAt: '2026-11-15',
            sources: [],
            declarations: [],
            limitations: [],
          };
        },
      },
      files: {
        discoverSkillFiles: async ({ cwd }: { cwd: string }) => ({
          skills: [{ name: 'review', path: `${cwd}/SKILL.md`, enabled: null, evidence: 'disk' }],
          problems: [],
        }),
      },
      launcher: { launcherFor: () => ({ executable: '/native-agent', env: {} }) },
    },
  });
  const api = module.exports;
  api.setProfiles(
    api.BUILTIN_PROFILES.map((profile: object) => ({
      ...profile,
      status: 'ready',
      version: 'fixture',
    })),
  );
  const host = new api.CatalogHandlers({
    sessions: { sessions: [] },
    output: { appendLine() {} },
    scheduleUpdate() {},
    surfaces: {},
    cwd: (surface: object) => targets.get(surface),
  });
  return {
    host,
    api,
    targets,
    stub,
    allow: () => {
      permission = 'Verify skills';
    },
    calls: () => nativeCalls,
    configurationCalls,
  };
}

test('passive host refresh is process-free, scoped by surface, and cannot toggle disk findings', async () => {
  const { host, api, targets, calls } = await fixture();
  const first = {};
  const second = {};
  targets.set(first, '/project-a');
  targets.set(second, '/project-b');
  const handlers = host.handlers();
  await handlers.refreshSkills(
    api.actionSchema.parse({ type: 'refreshSkills', agent: 'codex' }),
    first,
  );
  await handlers.refreshSkills(
    api.actionSchema.parse({ type: 'refreshSkills', agent: 'codex' }),
    second,
  );
  assert.equal(host.skillsAt('/project-a').codex.skills[0].path, '/project-a/SKILL.md');
  assert.equal(host.skillsAt('/project-b').codex.skills[0].path, '/project-b/SKILL.md');
  await assert.rejects(
    handlers.setSkillEnabled(
      { agent: 'codex', name: 'review', path: '/project-a/SKILL.md', enabled: false },
      first,
    ),
  );
  assert.throws(() => host.knownSkill('codex', 'review', '/project-a/SKILL.md', '/project-b'));
  assert.equal(calls(), 0);
});

test('native verification requires explicit acceptance; sending validates with the actual target cwd', async () => {
  const { host, targets, calls, allow } = await fixture();
  const surface = {};
  targets.set(surface, '/project');
  await host.handlers().verifySkills({ agent: 'claude' }, surface);
  assert.equal(calls(), 0);
  allow();
  await host.handlers().verifySkills({ agent: 'claude' }, surface);
  assert.equal(calls(), 1);
  const attachments = await host.checkSkills(
    'claude',
    [{ kind: 'skill', name: 'review', path: '/project/SKILL.md' }],
    '/actual-thread-cwd',
  );
  assert.equal(
    attachments[0].path,
    undefined,
    'Claude invocation uses the native command name, not an inferred source path',
  );
  assert.equal(host.skillsAt('/actual-thread-cwd').claude.status, 'ready');
  assert.equal(calls(), 2);
});

test('configuration actions resolve the surface context, use no native calls, and drop cancelled or displaced results', async () => {
  const { host, api, targets, calls, configurationCalls } = await fixture();
  const replies: any[] = [];
  const surface = {
    webview: {
      postMessage: async (message: unknown) => {
        replies.push(message);
      },
    },
  };
  targets.set(surface, '/selected-project');
  const action = api.actionSchema.parse({
    type: 'inspectConfiguration',
    agent: 'claude',
    requestId: 'one',
    cwd: '/forged-project',
  });
  assert.equal(action.cwd, undefined);
  await host.handlers().inspectConfiguration(action, surface);
  assert.deepEqual(configurationCalls, ['/selected-project']);
  assert.equal(replies[0].inspection.cwd, '/selected-project');
  const displaced = host.handlers().inspectConfiguration({ ...action, requestId: 'two' }, surface);
  targets.set(surface, '/another-project');
  await displaced;
  assert.equal(replies.length, 1);
  const cancelled = host
    .handlers()
    .inspectConfiguration({ ...action, requestId: 'three' }, surface);
  host.skillLoads.clear();
  await cancelled;
  assert.equal(replies.length, 1);
  assert.equal(calls(), 0);
});
