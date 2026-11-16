import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { copySkill, personalSkillsRoot, planSkillCopy } from '../../../src/providers/skill-copy';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'claudex-copy-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'from', 'review');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), '---\nname: review\ndescription: d\n---\nBody');
  await writeFile(path.join(source, 'scripts', 'run.sh'), 'echo hi');
  return { base, source, root: path.join(base, 'to', 'skills') };
}

test('personal skill roots: Claude follows its config dir, Codex shares ~/.agents/skills', () => {
  assert.equal(personalSkillsRoot('claude', { CLAUDE_CONFIG_DIR: '/c2' }, '/h'), '/c2/skills');
  assert.equal(personalSkillsRoot('claude', {}, '/h'), '/h/.claude/skills');
  assert.equal(personalSkillsRoot('codex', { CODEX_HOME: '/x' }, '/h'), '/h/.agents/skills');
});

test('a folder skill copies whole into a new folder, leaving no staging behind', async (t) => {
  const { source, root } = await fixture(t);
  const plan = await planSkillCopy(path.join(source, 'SKILL.md'), root);
  assert.equal(plan.files, 2);
  assert.equal(plan.destination, path.join(root, 'review'));
  await copySkill(plan);
  assert.match(await readFile(path.join(root, 'review', 'SKILL.md'), 'utf8'), /Body/);
  assert.equal(await readFile(path.join(root, 'review', 'scripts', 'run.sh'), 'utf8'), 'echo hi');
  assert.deepEqual(await readdir(root), ['review']);
});

test('a copy never replaces, follows links, or copies single-file commands', async (t) => {
  const { base, source, root } = await fixture(t);
  await mkdir(path.join(root, 'review'), { recursive: true });
  await assert.rejects(planSkillCopy(path.join(source, 'SKILL.md'), root), /already exists/);
  await rm(path.join(root, 'review'), { recursive: true });
  await symlink('/etc', path.join(source, 'escape'));
  await assert.rejects(planSkillCopy(path.join(source, 'SKILL.md'), root), /link/);
  const command = path.join(base, 'commands', 'deploy.md');
  await mkdir(path.dirname(command), { recursive: true });
  await writeFile(command, 'x');
  await assert.rejects(planSkillCopy(command, root), /Only folder skills/);
});

test('a destination that appears after review is left alone', async (t) => {
  const { source, root } = await fixture(t);
  const plan = await planSkillCopy(path.join(source, 'SKILL.md'), root);
  await mkdir(path.join(root, 'review'), { recursive: true });
  await writeFile(path.join(root, 'review', 'mine.md'), 'keep');
  await assert.rejects(copySkill(plan), /appeared|ENOTEMPTY|EEXIST/);
  assert.deepEqual(await readdir(path.join(root, 'review')), ['mine.md']);
  assert.deepEqual(await readdir(root), ['review']);
});
