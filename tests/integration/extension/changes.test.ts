import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectChanges } from '../../../src/extension/changes';
import { git } from '../../../src/infrastructure/git';

test('changes come from the real checkout: tracked, untracked, and non-repo folders', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-changes-'));
  assert.match((await collectChanges(root)).error ?? '', /not a Git repository/);
  await git(root, ['init']);
  await writeFile(path.join(root, 'kept.txt'), 'one\ntwo\n');
  await git(root, ['add', '.']);
  await git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Initial',
  ]);
  assert.deepEqual((await collectChanges(root)).files, []);
  await writeFile(path.join(root, 'kept.txt'), 'one\nTWO\n');
  await writeFile(path.join(root, 'new file.txt'), 'hello\n');
  const { files } = await collectChanges(root);
  const kept = files.find((file) => file.path === 'kept.txt');
  const added = files.find((file) => file.path === 'new file.txt');
  assert.equal(kept?.kind, 'update');
  assert.deepEqual([kept?.additions, kept?.deletions], [1, 1]);
  assert.match(kept?.patch ?? '', /^@@/);
  assert.equal(added?.kind, 'add');
  assert.equal(added?.additions, 1);
});
