import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countPatch,
  parsePatch,
  patchFromContent,
  patchFromEdit,
  stripPatchHeader,
} from '../../../../src/shared/domain/diff';

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
