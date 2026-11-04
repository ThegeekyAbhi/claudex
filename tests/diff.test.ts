import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectChanges } from '../src/changes';
import {
  countPatch,
  parsePatch,
  patchFromContent,
  patchFromEdit,
  stripPatchHeader,
} from '../src/diff';
import { displayCommand } from '../src/providers/tool-format';
import { git } from '../src/worktrees';

test('edit patches keep only what changed and claim no line numbers', () => {
  const patch = patchFromEdit('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nX\ne\nf\ng');
  assert.deepEqual(countPatch(patch), { additions: 1, deletions: 1 });
  const lines = parsePatch(patch);
  assert.deepEqual(
    lines.map((line) => line.text),
    ['b', 'c', 'd', 'X', 'e', 'f'],
  );
  assert.ok(lines.every((line) => line.kind !== 'hunk' && line.oldLine === undefined));
});
test('parsed hunks number old and new lines independently', () => {
  const lines = parsePatch('@@ -10,2 +20,3 @@\n keep\n-old\n+new\n+more');
  assert.deepEqual(lines[1], { kind: 'context', text: 'keep', oldLine: 10, newLine: 20 });
  assert.deepEqual(lines[2], { kind: 'del', text: 'old', oldLine: 11 });
  assert.deepEqual(lines[3], { kind: 'add', text: 'new', newLine: 21 });
  assert.deepEqual(lines[4], { kind: 'add', text: 'more', newLine: 22 });
});
test('lines that merely look like headers still count as changes', () => {
  assert.deepEqual(countPatch('@@ -1 +1 @@\n--- removed comment\n+++ added'), {
    additions: 1,
    deletions: 1,
  });
});
test('git preamble is removed and new content becomes additions', () => {
  assert.equal(
    stripPatchHeader('diff --git a/x b/x\nindex 1..2\n@@ -1 +1 @@\n-a\n+b\n'),
    '@@ -1 +1 @@\n-a\n+b',
  );
  assert.deepEqual(countPatch(patchFromContent('one\ntwo\n', '+')), { additions: 2, deletions: 0 });
});
test('shell wrappers are removed from displayed commands', () => {
  assert.equal(displayCommand(`/bin/zsh -lc 'command -v claude2'`), 'command -v claude2');
  assert.equal(displayCommand(`/bin/zsh -lc "zsh -ic 'claude2 -p hi'"`), `zsh -ic 'claude2 -p hi'`);
  assert.equal(displayCommand('pnpm test'), 'pnpm test');
});
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
