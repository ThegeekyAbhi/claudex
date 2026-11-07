import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  findCodexRollout,
  TranscriptClock,
} from '../../../../src/providers/history/transcript-files';

test('a transcript’s write time is read from its file, for each CLI, without reading it', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'aw-clock-'));
  const cwd = '/work/app';
  const claudeFile = path.join(home, 'claude/projects/-work-app/abc.jsonl');
  const codexFile = path.join(
    home,
    'codex/sessions/2026/11/07/rollout-2026-11-07T10-00-00-t1.jsonl',
  );
  for (const file of [claudeFile, codexFile]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{}\n');
    await utimes(file, 1_700_000_000, 1_700_000_000);
  }
  const claude = { CLAUDE_CONFIG_DIR: path.join(home, 'claude') };
  const codex = { CODEX_HOME: path.join(home, 'codex') };
  assert.equal(await findCodexRollout('t1', codex), codexFile);
  assert.equal(await findCodexRollout('missing', codex), undefined);
  const clock = new TranscriptClock();
  assert.equal(await clock.modifiedAt('claude', 'abc', cwd, claude), 1_700_000_000_000);
  assert.equal(await clock.modifiedAt('codex', 't1', cwd, codex), 1_700_000_000_000);
  assert.equal(await clock.modifiedAt('claude', 'missing', cwd, claude), undefined);
  // A removed file is looked for again rather than reported with a stale time.
  await rm(claudeFile);
  assert.equal(await clock.modifiedAt('claude', 'abc', cwd, claude), undefined);
});
