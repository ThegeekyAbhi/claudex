import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { actionGroups } from '../../../src/extension/action-groups';
import { actionSchema } from '../../../src/shared/model';

test('registered host handler keys cover the schema exactly once and match their declared groups', async () => {
  // Build real handler maps without constructing a controller or invoking any action.
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { WorkspaceController } from './src/extension/controller';
        import { ProfilesHandlers } from './src/extension/handlers/profiles';
        import { CatalogHandlers } from './src/extension/handlers/catalog';
        import { ThreadsHandlers } from './src/extension/handlers/threads';
        import { PlansHandlers } from './src/extension/handlers/plans';
        import { DocumentsHandlers } from './src/extension/handlers/documents';
        import { AttachmentsHandlers } from './src/extension/handlers/attachments';
        import { TerminalHandlers } from './src/extension/handlers/terminal';

        export const registered = {
          unrestricted: Object.keys(
            Reflect.get(WorkspaceController.prototype, 'surfaceHandlers').call({})
          ),
          profiles: Object.keys(new ProfilesHandlers({}).handlers()),
          catalog: Object.keys(new CatalogHandlers({}).handlers()),
          threads: Object.keys(new ThreadsHandlers({}).handlers()),
          plans: Object.keys(new PlansHandlers({}).handlers()),
          documents: Object.keys(new DocumentsHandlers({}).handlers()),
          attachments: Object.keys(new AttachmentsHandlers({}).handlers()),
          terminal: Object.keys(new TerminalHandlers({}).handlers()),
        };
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
            contents: 'module.exports = {};',
          }));
        },
      },
    ],
  });
  const module = { exports: {} as { registered: Record<string, string[]> } };
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    structuredClone,
  });
  const registered = module.exports.registered;
  const keys = Object.values(registered).flat();
  const discriminants = actionSchema.options.map((option) => option.shape.type.value);

  assert.deepEqual([...keys].sort(), [...discriminants].sort());
  assert.equal(new Set(keys).size, keys.length, 'No handler may be registered in two groups');
  assert.deepEqual(Object.keys(registered).sort(), Object.keys(actionGroups).sort());
  for (const [group, expected] of Object.entries(actionGroups)) {
    assert.deepEqual([...registered[group]].sort(), [...expected].sort(), group);
  }
});
