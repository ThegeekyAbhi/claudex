import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_PROFILES,
  runnableProfiles,
  type Skill,
  type SkillCatalogs,
  setProfiles,
} from '../../../../../src/shared/model';
import { ALL, selectRows } from '../../../../../src/webview/features/skills/skill-rows';

const skill = (name: string, path: string, source: Skill['source'] = 'personal'): Skill => ({
  name,
  description: `${name} skill`,
  enabled: null,
  evidence: 'disk',
  source,
  path,
});
const ready = (skills: Skill[]) => ({ status: 'ready' as const, problems: [], skills });

function withTwoAccounts(run: () => void) {
  setProfiles([...BUILTIN_PROFILES, { id: 'claud2', label: 'claud2', provider: 'claude' }]);
  try {
    run();
  } finally {
    setProfiles(BUILTIN_PROFILES);
  }
}

const catalogs: SkillCatalogs = {
  claude: ready([
    skill('review', '/h/.claude/skills/review/SKILL.md'),
    skill('repo-rules', '/p/.claude/skills/repo-rules/SKILL.md', 'project'),
  ]),
  claud2: ready([skill('polish', '/h/.claude2/skills/polish/SKILL.md')]),
  codex: ready([]),
};

test('one account lists its own skills, grouped by source, with personal ones eligible', () =>
  withTwoAccounts(() => {
    const picked = selectRows({
      catalogs,
      accounts: runnableProfiles(),
      scope: 'claude',
      agent: 'claude',
      missingOnly: false,
      search: '',
    });
    assert.deepEqual(
      picked.groups.map((group) => [group.source, group.rows.map((row) => row.skill.name)]),
      [
        ['project', ['repo-rules']],
        ['personal', ['review']],
      ],
    );
    assert.deepEqual(
      picked.eligible.map((row) => row.skill.name),
      ['review'],
    );
    assert.deepEqual(
      picked.missing.map((row) => [row.skill.name, row.owner]),
      [['polish', 'claud2']],
    );
  }));

test('missing-only lists other accounts’ skills, and search narrows any view', () =>
  withTwoAccounts(() => {
    const base = {
      catalogs,
      accounts: runnableProfiles(),
      agent: 'claude',
      search: '',
    };
    const missing = selectRows({ ...base, scope: 'claude', missingOnly: true });
    assert.deepEqual(
      missing.rows.map((row) => row.skill.name),
      ['polish'],
    );
    const all = selectRows({ ...base, scope: ALL, missingOnly: false });
    assert.equal(all.allCount, 3);
    assert.deepEqual(all.missing, []);
    const searched = selectRows({ ...base, scope: ALL, missingOnly: false, search: 'polish' });
    assert.deepEqual(
      searched.rows.map((row) => [row.skill.name, row.owner]),
      [['polish', 'claud2']],
    );
    assert.equal(searched.allCount, 3);
  }));
