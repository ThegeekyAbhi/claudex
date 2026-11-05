import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDocument, listDocuments, readDocument } from '../src/host/documents';
import { resolveInside } from '../src/providers/shared/paths';

test('documents remain ordinary files, and external edits are visible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-docs-'));
  const relative = await createDocument(root, 'task', 'Render compiler');
  assert.match(await readDocument(root, relative), /## Acceptance criteria/);
  await writeFile(path.join(root, relative), '# Changed externally\n');
  assert.equal(await readDocument(root, relative), '# Changed externally\n');
  assert.equal((await listDocuments(root))[0].path, relative);
});
test('preview and creation reject traversal and symlink escapes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-safe-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'aw-outside-'));
  await writeFile(path.join(outside, 'secret.md'), '# Private');
  await mkdir(path.join(root, 'docs'));
  await symlink(outside, path.join(root, 'docs/agent-work'));
  await assert.rejects(() => createDocument(root, 'plan', 'Escape'), /outside/);
  await assert.rejects(() => readDocument(root, 'docs/agent-work/secret.md'), /outside/);
  await assert.rejects(() => resolveInside(root, outside), /relative/);
  await assert.rejects(() => readDocument(root, '../secret.md'));
});
test('document listings omit symlinked files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-list-'));
  await mkdir(path.join(root, 'docs/agent-work'), { recursive: true });
  await writeFile(path.join(root, 'outside.md'), '# Other');
  await symlink(path.join(root, 'outside.md'), path.join(root, 'docs/agent-work/link.md'));
  assert.deepEqual(await listDocuments(root), []);
});
