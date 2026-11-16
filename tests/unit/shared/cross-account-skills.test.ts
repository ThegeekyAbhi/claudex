import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AgentProfile,
  actionSchema,
  attachmentLabel,
  attachmentSchema,
  BUILTIN_PROFILES,
  type Skill,
  type SkillCatalogs,
  searchOtherSkills,
  setProfiles,
  skillsAcross,
} from '../../../src/shared/model';

const SECOND: AgentProfile = { id: 'claud2', label: 'claud2', provider: 'claude' };
function withProfiles(run: () => void) {
  setProfiles([...BUILTIN_PROFILES, SECOND]);
  try {
    run();
  } finally {
    setProfiles(BUILTIN_PROFILES);
  }
}
const skill = (name: string, path?: string, description = ''): Skill => ({
  name,
  description,
  enabled: null,
  evidence: 'disk',
  ...(path ? { path } : {}),
});
const ready = (skills: Skill[]) => ({ status: 'ready' as const, problems: [], skills });

const catalogs: SkillCatalogs = {
  claude: ready([
    skill('better-ui', '/h/.claude/skills/better-ui/SKILL.md', 'Polish an interface'),
    skill('review', '/h/.claude/skills/review/SKILL.md'),
    skill('no-file'),
  ]),
  claud2: ready([skill('review', '/h/.claude2/skills/review/SKILL.md')]),
  codex: ready([
    skill('better-ui', '/h/.agents/skills/better-ui/SKILL.md'),
    skill('ui-audit', '/h/.agents/skills/ui-audit/SKILL.md', 'Audits screens'),
  ]),
};

test('/ offers other accounts’ skills this account lacks, borrowable ones only', () => {
  withProfiles(() => {
    const found = searchOtherSkills(catalogs, 'claud2', 'ui');
    assert.deepEqual(
      found.map((item) => [item.skill.name, item.from]),
      [
        // A name starting with the search first, then names containing it; one row per file.
        ['ui-audit', 'codex'],
        // The same name in two accounts is one row, read from the first.
        ['better-ui', 'claude'],
      ],
    );
    // This account's own names never reappear, and a skill without a file can't be borrowed.
    assert.equal(searchOtherSkills(catalogs, 'claud2', 'review').length, 0);
    assert.equal(searchOtherSkills(catalogs, 'claud2', 'no-file').length, 0);
  });
});

test('a skill folder shared by accounts is one borrowable row, naming every account', () => {
  withProfiles(() => {
    const shared = '/h/.agents/skills/shared/SKILL.md';
    const found = searchOtherSkills(
      {
        ...catalogs,
        claude: ready([skill('shared', shared)]),
        claud2: ready([skill('shared', shared)]),
      },
      'codex',
      'shared',
    );
    assert.deepEqual(
      found.map((item) => [item.from, item.alsoIn]),
      [['claude', ['claud2']]],
    );
  });
});

test('the Skills page lists each skill once with every account that has it', () => {
  withProfiles(() => {
    const rows = skillsAcross(catalogs);
    const review = rows.filter((row) => row.skill.name === 'review');
    assert.equal(review.length, 2, 'two files with one name stay two skills');
    const noFile = rows.find((row) => row.skill.name === 'no-file');
    assert.deepEqual(noFile?.in, ['claude']);
  });
});

test('a borrowed skill names its account, which must be a valid profile id', () => {
  withProfiles(() => {
    const borrowed = { kind: 'skill', name: 'review', path: '/x/SKILL.md', from: 'claud2' };
    assert.equal(attachmentSchema.safeParse(borrowed).success, true);
    assert.equal(attachmentLabel(attachmentSchema.parse(borrowed)), 'review · from claud2');
    assert.equal(attachmentSchema.safeParse({ ...borrowed, from: '../etc' }).success, false);
  });
});

test('making skills global is a validated batch naming each skill’s account', () => {
  const one = { agent: 'claude', name: 'review', path: '/x/SKILL.md' };
  const ok = (skills: unknown) =>
    actionSchema.safeParse({ type: 'makeSkillsGlobal', skills }).success;
  assert.equal(ok([one]), true);
  assert.equal(ok([one, { ...one, agent: 'codex' }]), true);
  assert.equal(ok([]), false, 'an empty selection is not a request');
  assert.equal(ok([{ ...one, agent: '../x' }]), false);
  assert.equal(ok(Array.from({ length: 501 }, () => one)), false);
  assert.equal(actionSchema.safeParse({ type: 'makeSkillGlobal', ...one }).success, false);
});

test('one global skill reached through several accounts is one row', () => {
  withProfiles(() => {
    const linked = (path: string) => ({ ...skill('polish', path), global: true });
    const rows = skillsAcross({
      claude: ready([linked('/h/.claude/skills/polish/SKILL.md')]),
      claud2: ready([linked('/h/.claude2/skills/polish/SKILL.md')]),
      codex: ready([linked('/h/.agents/skills/polish/SKILL.md')]),
    });
    assert.deepEqual(
      rows.map((row) => [row.skill.name, row.in]),
      [['polish', ['claude', 'codex', 'claud2']]],
    );
  });
});
