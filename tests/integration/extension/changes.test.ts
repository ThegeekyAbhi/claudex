import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectChanges, readAtRevision } from '../../../src/extension/changes';
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
  assert.equal(kept?.patch, '', 'the list carries metadata; VS Code renders content');
  assert.equal(added?.kind, 'add');
  assert.equal(added?.additions, 1);
});

test('unborn repositories include staged additions and normalize nested checkout paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-unborn-'));
  await git(root, ['init']);
  await writeFile(path.join(root, 'first.txt'), 'first\n');
  await git(root, ['add', '.']);
  const result = await collectChanges(root);
  assert.equal(result.files[0]?.kind, 'add');
  assert.equal(result.files[0]?.additions, 1);
  assert.equal(result.baseline, undefined);
});

test('checkout review includes more than 200 files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-many-'));
  await git(root, ['init']);
  await Promise.all(
    Array.from({ length: 205 }, (_, index) => writeFile(path.join(root, `${index}.txt`), 'new\n')),
  );
  const result = await collectChanges(root);
  assert.equal(result.files.length, 205);
  assert.equal(result.truncated, undefined);
});

test('checkout listing reports deletes, renames, binaries, and the HEAD baseline', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-kinds-'));
  await git(root, ['init']);
  await writeFile(path.join(root, 'gone.txt'), 'bye\n');
  await writeFile(path.join(root, 'old-name.txt'), 'same\ncontent\nhere\n');
  await writeFile(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2]));
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
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await rm(path.join(root, 'gone.txt'));
  await git(root, ['mv', 'old-name.txt', 'new-name.txt']);
  await writeFile(path.join(root, 'blob.bin'), Buffer.from([3, 0, 4]));
  const result = await collectChanges(root);
  assert.equal(result.baseline, head);
  const byPath = new Map(result.files.map((file) => [file.path, file]));
  assert.equal(byPath.get('gone.txt')?.kind, 'delete');
  assert.equal(byPath.get('gone.txt')?.deletions, 1);
  assert.equal(byPath.get('new-name.txt')?.kind, 'rename');
  assert.equal(byPath.get('new-name.txt')?.original, 'old-name.txt');
  assert.equal(byPath.get('blob.bin')?.binary, true);
});

test('the Changes editor reads the committed side from the path and commit alone', async () => {
  // tmpdir() is a symlink on macOS; Git reports the real path.
  const root = await mkdtemp(path.join(tmpdir(), 'aw-revision-'));
  await git(root, ['init']);
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'file.ts'), 'before\n');
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
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await writeFile(path.join(root, 'nested', 'file.ts'), 'after\n');
  assert.equal(await readAtRevision(path.join(root, 'nested', 'file.ts'), head), 'before\n');
  // A deleted folder still resolves through its nearest existing parent.
  await rm(path.join(root, 'nested'), { recursive: true });
  assert.equal(await readAtRevision(path.join(root, 'nested', 'file.ts'), head), 'before\n');
  await assert.rejects(readAtRevision(path.join(root, 'nested', 'file.ts'), 'HEAD; rm -rf'));
  await assert.rejects(readAtRevision(path.join(root, '..', 'outside.ts'), head));
});
