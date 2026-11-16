import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { discoverSkillFiles } from '../../../src/providers/skill-files';
import {
  applyGlobalSkill,
  describeGlobalOutcomes,
  type GlobalSkillPlan,
  globalOutcome,
  planGlobalSkill,
  skillLibraryRoot,
} from '../../../src/providers/skill-library';

async function fixture(t: TestContext) {
  const home = await mkdtemp(path.join(tmpdir(), 'claudex-global-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const account = (id: string) => ({ id, label: id, root: path.join(home, `.${id}`, 'skills') });
  async function skill(folder: string, body = 'Body') {
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'SKILL.md'),
      `---\nname: polish\ndescription: d\n---\n${body}`,
    );
    return path.join(folder, 'SKILL.md');
  }
  const trashed: string[] = [];
  const trash = async (folder: string) => {
    trashed.push(folder);
    await rm(folder, { recursive: true });
  };
  return { home, account, skill, trashed, trash };
}

test('making a skill global keeps one copy in ~/.agents/skills and links every Claude account', async (t) => {
  const { home, account, skill, trashed, trash } = await fixture(t);
  const main = account('claude');
  const second = account('claude-two');
  const file = await skill(path.join(main.root, 'polish'));
  const plan = await planGlobalSkill(file, [main, second], home);
  const library = path.join(skillLibraryRoot(home), 'polish');
  assert.equal(plan.library, library);
  assert.ok(plan.copy, 'copied into the library first');
  assert.deepEqual(
    plan.replace.map((item) => item.id),
    ['claude'],
    'the original becomes a link',
  );
  assert.deepEqual(
    plan.link.map((item) => item.id),
    ['claude-two'],
  );
  const result = await applyGlobalSkill(plan, trash);
  assert.deepEqual(result.linked.sort(), ['claude', 'claude-two']);
  assert.deepEqual(trashed, [path.join(main.root, 'polish')], 'only the identical copy is trashed');
  for (const entry of [path.join(main.root, 'polish'), path.join(second.root, 'polish')]) {
    assert.ok((await lstat(entry)).isSymbolicLink());
    assert.equal(await readlink(entry), library);
  }
  assert.match(await readFile(path.join(library, 'SKILL.md'), 'utf8'), /Body/);
  // Both CLIs now find it through their own folders, and know it's global.
  const project = path.join(home, 'project');
  await mkdir(path.join(project, '.git'), { recursive: true });
  for (const [provider, env] of [
    ['claude', { CLAUDE_CONFIG_DIR: path.join(home, '.claude-two') }],
    ['codex', { CODEX_HOME: path.join(home, '.codex-other') }],
  ] as const) {
    const { skills } = await discoverSkillFiles({ provider, cwd: project, home, env });
    assert.deepEqual(
      skills.map((item) => [item.name, item.global]),
      [['polish', true]],
      provider,
    );
  }
  // Again: nothing left to do.
  const again = await planGlobalSkill(path.join(library, 'SKILL.md'), [main, second], home);
  assert.equal(again.copy, undefined);
  assert.equal(again.link.length + again.replace.length, 0);
});

test('a different version is never replaced, in the library or in an account', async (t) => {
  const { home, account, skill, trash } = await fixture(t);
  const main = account('claude');
  const other = account('claude-two');
  const file = await skill(path.join(main.root, 'polish'));
  await skill(path.join(other.root, 'polish'), 'Edited by hand');
  const plan = await planGlobalSkill(file, [main, other], home);
  assert.deepEqual(
    plan.keep.map((item) => [item.id, item.reason]),
    [['claude-two', 'has its own, different version']],
  );
  await applyGlobalSkill(plan, trash);
  assert.match(
    await readFile(path.join(other.root, 'polish', 'SKILL.md'), 'utf8'),
    /Edited by hand/,
  );
  // A different skill already in the library stops the whole change.
  const third = account('claude-three');
  const conflicting = await skill(path.join(third.root, 'polish'), 'Third version');
  await assert.rejects(planGlobalSkill(conflicting, [third], home), /different “polish”/);
});

test('a link to somewhere else is left alone, and a copy edited after review is not trashed', async (t) => {
  const { home, account, skill, trashed, trash } = await fixture(t);
  const main = account('claude');
  const linked = account('claude-two');
  const file = await skill(path.join(main.root, 'polish'));
  const elsewhere = await skill(path.join(home, 'elsewhere', 'polish'), 'Elsewhere');
  await mkdir(linked.root, { recursive: true });
  await symlink(path.dirname(elsewhere), path.join(linked.root, 'polish'));
  const plan = await planGlobalSkill(file, [main, linked], home);
  assert.deepEqual(
    plan.keep.map((item) => item.reason),
    ['links to a different folder'],
  );
  await applyGlobalSkill(plan, trash);
  assert.equal(await readlink(path.join(linked.root, 'polish')), path.dirname(elsewhere));
  // Another account's identical copy, edited between review and apply, is kept.
  const third = account('claude-three');
  const library = path.join(skillLibraryRoot(home), 'polish', 'SKILL.md');
  await skill(path.join(third.root, 'polish'));
  const next = await planGlobalSkill(library, [third], home);
  assert.deepEqual(
    next.replace.map((item) => item.id),
    ['claude-three'],
  );
  await writeFile(path.join(third.root, 'polish', 'SKILL.md'), 'changed after review');
  trashed.length = 0;
  const result = await applyGlobalSkill(next, trash);
  assert.deepEqual(trashed, []);
  assert.equal(result.skipped[0]?.reason, 'its copy changed; left as it is');
});

test('a skill is reported global only when every account has it', () => {
  const plan = (extra: Partial<GlobalSkillPlan> = {}): GlobalSkillPlan => ({
    name: 'review',
    library: '/lib/review',
    link: [],
    replace: [],
    keep: [],
    ...extra,
  });
  const account = { id: 'claude-2', label: 'claud2', entry: '/c2/skills/review' };
  assert.deepEqual(globalOutcome(plan()), { name: 'review', state: 'alreadyGlobal', notes: [] });
  // Nothing to do because an account has its own version is a conflict, not "already global".
  const conflict = globalOutcome(
    plan({ keep: [{ ...account, reason: 'has its own, different version' }] }),
  );
  assert.equal(conflict.state, 'conflict');
  assert.deepEqual(conflict.notes, ['claud2 has its own, different version']);
  const linking = plan({ link: [account] });
  assert.equal(globalOutcome(linking, { linked: ['claud2'], skipped: [] }).state, 'done');
  assert.equal(
    globalOutcome(linking, {
      linked: [],
      skipped: [{ label: 'claud2', reason: 'a folder appeared; left as it is' }],
    }).state,
    'partial',
  );
  assert.equal(globalOutcome(linking, new Error('disk full')).state, 'failed');

  const report = describeGlobalOutcomes([conflict]);
  assert.equal(report.warning, true);
  assert.doesNotMatch(report.text, /already global/);
  assert.match(report.text, /review \(unchanged: claud2 has its own, different version\)/);
  assert.deepEqual(describeGlobalOutcomes([globalOutcome(plan())]), {
    text: '“review” was already global for every account.',
    warning: false,
  });
});
