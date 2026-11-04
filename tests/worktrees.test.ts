import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorktree, git, parseGitStatus } from '../src/worktrees';

test('worktrees start from HEAD and preserve dirty source checkouts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-git-'));
  await git(root, ['init']);
  await writeFile(path.join(root, 'file.txt'), 'committed');
  await git(root, ['add', 'file.txt']);
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
  await writeFile(path.join(root, 'file.txt'), 'uncommitted');
  const worktree = await createWorktree(root);
  assert.equal(await readFile(path.join(worktree, 'file.txt'), 'utf8'), 'committed');
  assert.equal(await readFile(path.join(root, 'file.txt'), 'utf8'), 'uncommitted');
  assert.match(await git(worktree, ['branch', '--show-current']), /agent-workspace\/agent-/);
});
test('status parsing preserves spaces and rename source paths', () => {
  assert.deepEqual(
    parseGitStatus('R  new name.ts\0old name.ts\0?? fresh file.md\0 M changed.ts\0'),
    [
      { file: 'new name.ts', original: 'old name.ts', status: 'R ' },
      { file: 'fresh file.md', original: undefined, status: '??' },
      { file: 'changed.ts', original: undefined, status: ' M' },
    ],
  );
});
