import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { git } from '../../../src/infrastructure/git';

test('shared git helper preserves stdout, cwd, argument boundaries and failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-shared-git-'));
  try {
    await git(root, ['init']);
    await git(root, ['config', 'boundary.value', 'a value with spaces']);
    assert.equal(await git(root, ['config', '--get', 'boundary.value']), 'a value with spaces\n');
    await assert.rejects(git(root, ['config', '--get', 'boundary.missing']));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
