import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

async function fixture() {
  const calls: { method: string; params?: any }[] = [];
  const queries: any[] = [];
  let disposed = 0;
  let closed = 0;
  class FakeRpc {
    async request(method: string, params: unknown) {
      calls.push({ method, params });
      if (method === 'model/list') return { data: [{ id: 'codex', displayName: 'Codex' }] };
      if (method === 'skills/list') return { data: [{ skills: [] }] };
      return {};
    }
    write(message: { method: string }) {
      calls.push(message);
    }
    dispose() {
      disposed++;
    }
  }
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export { listClaudeModels, listCodexModels } from './src/application/catalogs/model-catalog';
      export { listClaudeSkills, listCodexSkills } from './src/providers/native-skills';
    `,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'metadata-stubs',
        setup(builder) {
          builder.onResolve({ filter: /\/process$/ }, () => ({ path: 'rpc', namespace: 'fake' }));
          builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({
            path: 'sdk',
            namespace: 'fake',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fake' }, ({ path }) => ({
            contents: `module.exports = globalThis.stubs.${path};`,
          }));
        },
      },
    ],
  });
  const module = { exports: {} as any };
  runInNewContext(output.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    process,
    setTimeout,
    clearTimeout,
    stubs: {
      rpc: { JsonRpc: FakeRpc },
      sdk: {
        query: (request: any) => {
          queries.push(request);
          return {
            supportedModels: async () => [
              { value: 'default' },
              { value: 'sonnet', displayName: 'Sonnet', description: 'Model' },
            ],
            supportedCommands: async () => [{ name: 'review', description: 'Review code' }],
            close: () => {
              closed++;
            },
          };
        },
      },
    },
  });
  return { api: module.exports, calls, queries, disposed: () => disposed, closed: () => closed };
}

test('model and skill callers retain separate Claude setting sources and empty input', async () => {
  const run = await fixture();
  const models = await run.api.listClaudeModels('/installed/claude', '/project');
  const skills = await run.api.listClaudeSkills('/installed/claude', '/project');
  assert.equal(models[0].id, 'sonnet');
  assert.equal(skills.skills[0].name, 'review');
  assert.deepEqual(Array.from(run.queries[0].options.settingSources), []);
  assert.deepEqual(Array.from(run.queries[1].options.settingSources), ['user', 'project', 'local']);
  for (const query of run.queries) {
    assert.equal(typeof query.prompt, 'object');
    assert.equal((await query.prompt[Symbol.asyncIterator]().next()).done, true);
    assert.equal(query.options.pathToClaudeCodeExecutable, '/installed/claude');
    assert.equal(query.options.cwd, '/project');
  }
  assert.equal(run.closed(), 2);
});

test('model and skill callers each initialize once with their own Codex capability and dispose', async () => {
  const run = await fixture();
  await run.api.listCodexModels('/installed/codex', '/project');
  await run.api.listCodexSkills('/installed/codex', '/project');
  assert.deepEqual(
    run.calls.map((call) => call.method),
    ['initialize', 'initialized', 'model/list', 'initialize', 'initialized', 'skills/list'],
  );
  assert.equal(run.calls[0].params.capabilities.experimentalApi, true);
  assert.equal(run.calls[3].params.capabilities.experimentalApi, false);
  assert.equal(run.disposed(), 2);
});
