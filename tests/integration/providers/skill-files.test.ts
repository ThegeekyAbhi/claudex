import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { discoverSkillFiles, skillFileMetadata } from '../../../src/providers/skill-files';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'claudex-skills-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  await mkdir(path.join(project, '.git'), { recursive: true });
  await mkdir(home);
  async function skill(folder: string, name: string, body = '') {
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Review code\n---\n${body}`,
    );
  }
  return { base, home, project, skill };
}

test('passive discovery reads inert metadata in the selected checkout without running repository hooks or scripts', async (t) => {
  const { base, home, project, skill } = await fixture(t);
  const marker = path.join(base, 'executed');
  const command = `touch ${marker}`;
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await writeFile(
    path.join(project, '.claude/settings.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }),
  );
  await skill(path.join(project, '.claude/skills/review'), 'review', `!\`${command}\`\n`);
  await skill(path.join(home, '.claude/skills/personal'), 'personal');
  const result = await discoverSkillFiles({ provider: 'claude', cwd: project, home, env: {} });
  assert.deepEqual(
    result.skills.map((s) => [s.name, s.source, s.enabled, s.evidence]),
    [
      ['personal', 'personal', null, 'disk'],
      ['review', 'project', null, 'disk'],
    ],
  );
  await assert.rejects(access(marker));
  const other = path.join(base, 'other');
  await mkdir(path.join(other, '.git'), { recursive: true });
  const isolated = await discoverSkillFiles({ provider: 'claude', cwd: other, home, env: {} });
  assert.ok(!isolated.skills.some((s) => s.name === 'review'));
});

test('shared Codex roots remain shared across homes, symlink duplicates deduplicate, and duplicate names remain visible', async (t) => {
  const { home, project, skill } = await fixture(t);
  await skill(path.join(home, '.agents/skills/shared'), 'review');
  await skill(path.join(project, '.agents/skills/project'), 'review');
  await symlink(
    path.join(home, '.agents/skills/shared'),
    path.join(home, '.agents/skills/linked'),
    'dir',
  );
  for (const profile of ['codex-one', 'codex-two']) {
    const result = await discoverSkillFiles({
      provider: 'codex',
      cwd: project,
      home,
      env: { CODEX_HOME: path.join(home, profile) },
    });
    assert.equal(result.skills.filter((s) => s.name === 'review').length, 2);
    assert.ok(result.problems.some((p) => p.startsWith('Multiple files declare review')));
  }
});

test('malformed or oversized files are diagnostic, cancelled discovery stops, and legacy commands stay unverified', async (t) => {
  const { home, project, skill } = await fixture(t);
  await skill(path.join(project, '.claude/skills/large'), 'large', 'x'.repeat(70000));
  await mkdir(path.join(project, '.claude/commands'), { recursive: true });
  await writeFile(
    path.join(project, '.claude/commands/task.md'),
    '---\ndescription: Task\n---\nDo things',
  );
  const result = await discoverSkillFiles({ provider: 'claude', cwd: project, home, env: {} });
  assert.equal(result.skills[0].name, 'task');
  assert.equal(result.skills[0].enabled, null);
  assert.equal(result.problems.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discoverSkillFiles({
      provider: 'claude',
      cwd: project,
      home,
      env: {},
      signal: controller.signal,
    }),
  );
  assert.throws(() =>
    skillFileMetadata('---\nname: x\nname: y\ndescription: d\n---\n', 'fallback', 'codex'),
  );
  assert.throws(() =>
    skillFileMetadata('---\nname: x\ndescription: !exec danger\n---\n', 'fallback', 'codex'),
  );
});
