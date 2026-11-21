import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { existingFiles } from '../../../../src/extension/pages/page-paths';
import { FILE_REFERENCE, filePart } from '../../../../src/shared/domain/file-refs';

test('only files inside the workspace become chips', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'paths-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'app.ts'), '');
    await writeFile(path.join(root, 'a b.md'), '');
    const found = await existingFiles(root, [
      'src/app.ts',
      './src/app.ts:12',
      'src/app.ts:3-9',
      'a%20b.md',
      'src',
      'src/missing.ts',
      '../etc/passwd',
      '/etc/passwd',
    ]);
    assert.deepEqual(found, ['src/app.ts', './src/app.ts:12', 'src/app.ts:3-9', 'a%20b.md']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('path references are recognised as written', () => {
  for (const ok of ['src/a.ts', './src/a.tsx:12', 'package.json', 'docs/usage.md:4-9'])
    assert.ok(FILE_REFERENCE.test(ok), ok);
  for (const no of ['claude', 'npm run build', 'v1', 'https://x.dev/a.ts'])
    assert.equal(FILE_REFERENCE.test(no), false, no);
  assert.equal(filePart('./src/a.ts:12-20'), 'src/a.ts');
});
