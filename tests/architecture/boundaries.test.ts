import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
const forbidden: Record<string, string[]> = {
  shared: ['application', 'infrastructure', 'extension', 'providers', 'webview'],
  webview: ['application', 'infrastructure', 'extension', 'providers'],
  application: ['extension'],
  infrastructure: ['extension'],
  providers: ['extension', 'application'],
};
const builtins = new Set(builtinModules);

function violations(file: string, source: string): string[] {
  const layer = file.split('/')[0];
  const denied = forbidden[layer] ?? [];
  // Biome matches specifier text; resolve paths too, including the webview's @/ alias.
  const imports = source.matchAll(
    /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"\r\n]+)['"]/g,
  );
  const errors: string[] = [];
  for (const [, specifier] of imports) {
    let resolved = specifier;
    if (specifier.startsWith('.')) {
      resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    } else if (specifier.startsWith('@/')) {
      resolved = path.posix.normalize(`webview/${specifier.slice(2)}`);
    }
    const target = resolved.split('/')[0];
    if (
      (layer !== 'extension' && specifier === 'vscode') ||
      (['shared', 'webview'].includes(layer) &&
        (specifier.startsWith('node:') || builtins.has(specifier))) ||
      denied.includes(target)
    ) {
      errors.push(`${file}: ${specifier}`);
    }
  }
  return errors;
}

async function scan(directory: string): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) errors.push(...(await scan(file)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      errors.push(
        ...violations(
          path.relative(sourceRoot, file).split(path.sep).join('/'),
          await readFile(file, 'utf8'),
        ),
      );
    }
  }
  return errors;
}

test('source imports respect the layer boundaries', async () => {
  assert.deepEqual(await scan(sourceRoot), []);
});

test('boundary scanner catches forbidden imports, exports, dynamic imports and require', () => {
  for (const [layer, targets] of Object.entries(forbidden)) {
    const file = `${layer}/nested/probe.ts`;
    for (const target of targets) {
      for (const source of [
        `import type { Value } from '../../${target}/module';`,
        `export * from '../../${target}/module';`,
        `import('../../${target}/module');`,
        `require('../../${target}/module');`,
      ]) {
        assert.equal(violations(file, source).length, 1, `${file}: ${source}`);
      }
    }
    assert.equal(violations(file, "import 'vscode';").length, 1);
    assert.deepEqual(violations(file, "import '../../shared/model';"), []);
  }
  for (const layer of ['shared', 'webview']) {
    for (const specifier of ['node:fs/promises', 'fs', 'fs/promises', '@/../extension/worktrees']) {
      assert.equal(violations(`${layer}/probe.ts`, `import '${specifier}';`).length, 1);
    }
  }
  assert.equal(
    violations('shared/probe.ts', "import '../shared/../extension/worktrees';").length,
    1,
  );
});

test('Node layers retain Node imports and the extension can import vscode', () => {
  for (const layer of ['application', 'infrastructure', 'providers', 'extension']) {
    assert.deepEqual(violations(`${layer}/probe.ts`, "import 'node:fs';"), []);
  }
  assert.deepEqual(violations('extension/probe.ts', "import 'vscode';"), []);
  assert.deepEqual(violations('webview/probe.ts', "import '@/components/ui/button';"), []);
});
