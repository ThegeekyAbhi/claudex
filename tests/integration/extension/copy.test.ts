import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { actionSchema } from '../../../src/shared/model';

test('copy acknowledges clipboard success and failure using the caller request ID', async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import { DocumentsHandlers } from './src/extension/handlers/documents';
        export const copy = new DocumentsHandlers({}).handlers().copy;`,
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
            contents: 'module.exports = globalThis.vscode;',
          }));
        },
      },
    ],
  });
  const writes: string[] = [];
  let fail = false;
  const module = { exports: {} as { copy: (action: unknown, surface: unknown) => Promise<void> } };
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    vscode: {
      env: {
        clipboard: {
          writeText: async (text: string) => {
            if (fail) throw new Error('Clipboard unavailable');
            writes.push(text);
          },
        },
      },
    },
  });
  const received: unknown[] = [];
  const surface = {
    webview: {
      postMessage: async (message: unknown) => {
        received.push(JSON.parse(JSON.stringify(message)));
      },
    },
  };
  await module.exports.copy(
    actionSchema.parse({ type: 'copy', text: '**hello**', requestId: 'one' }),
    surface,
  );
  assert.deepEqual(writes, ['**hello**']);
  assert.deepEqual(received, [{ type: 'copyResult', requestId: 'one', ok: true }]);
  fail = true;
  await module.exports.copy({ type: 'copy', text: 'hello', requestId: 'two' }, surface);
  assert.deepEqual(received.at(-1), { type: 'copyResult', requestId: 'two', ok: false });
  await assert.rejects(
    module.exports.copy({ type: 'copy', text: 'legacy caller' }, surface),
    /Clipboard unavailable/,
  );
  assert.equal(
    actionSchema.safeParse({ type: 'copy', text: 'hello', requestId: '' }).success,
    false,
  );
});
