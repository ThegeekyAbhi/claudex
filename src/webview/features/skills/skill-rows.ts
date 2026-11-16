import {
  type AgentKind,
  missingSkills,
  type Skill,
  type SkillCatalog,
  type SkillCatalogs,
  type SkillSource,
  searchSkills,
  skillKey,
  skillsAcross,
  skillsFor,
} from '../../../shared/model';

/**
 * What the Skills page lists for a scope, a search and a filter. Pure: it reads the catalogs it
 * is given and the accounts passed in, so the page only holds state and draws.
 */

export const ALL = 'all';
export type Scope = AgentKind | typeof ALL;

export const SOURCE_ORDER: (SkillSource | 'other')[] = [
  'project',
  'personal',
  'plugin',
  'system',
  'admin',
  'other',
];

/** One row: a skill, which accounts list it, and the one it is read from. */
export interface Row {
  skill: Skill;
  owner: AgentKind;
  in: AgentKind[];
}

interface Account {
  id: AgentKind;
  label: string;
}

/** A row's identity on this page: the account it is read from, and its file. */
export function rowId(row: Row): string {
  return `${row.owner}\n${row.skill.path ?? row.skill.name}`;
}

export function globalRequest(row: Row) {
  return { agent: row.owner, name: row.skill.name, path: row.skill.path ?? '' };
}

/**
 * Offered for a personal folder skill unless every account already reaches it through the
 * global folder. Project skills belong to their repository, so they stay where they are.
 */
export function canMakeGlobal(skill: Skill, catalogs: SkillCatalogs, accounts: Account[]): boolean {
  if (skill.source !== 'personal' || !skill.path?.endsWith('/SKILL.md')) return false;
  if (!skill.global) return true;
  return !accounts.every((account) =>
    skillsFor(catalogs, account.id).skills.some(
      (other) => other.global && other.name === skill.name,
    ),
  );
}

/** Every account's status as one: loading while any is, with each account's problems named. */
export function combinedStatus(catalogs: SkillCatalogs, accounts: Account[]): SkillCatalog {
  const all = accounts.map((account) => ({
    label: account.label,
    catalog: skillsFor(catalogs, account.id),
  }));
  return {
    status: all.some((item) => item.catalog.status === 'loading') ? 'loading' : 'ready',
    skills: [],
    problems: all.flatMap((item) =>
      item.catalog.problems.map((problem) => `${item.label}: ${problem}`),
    ),
    stale: all.some((item) => item.catalog.stale),
  };
}

/** The same skill listed by several accounts becomes one row naming all of them. */
export function dedupe(rows: Row[]): Row[] {
  const seen = new Map<string, Row>();
  for (const row of rows) {
    const key = skillKey(row.skill);
    const found = seen.get(key);
    if (found) found.in.push(...row.in.filter((id) => !found.in.includes(id)));
    else seen.set(key, { ...row, in: [...row.in] });
  }
  return [...seen.values()];
}

/** The page shows turned-off skills too, so it searches without dropping them. */
export function filterRows(rows: Row[], query: string): Row[] {
  if (!query.trim()) return rows;
  const matches = new Set(
    searchSkills(
      rows.map((row) => ({ ...row.skill, enabled: true })),
      query.trim(),
    ).map((skill) => `${skill.path ?? ''}\n${skill.name}`),
  );
  return rows.filter((row) => matches.has(`${row.skill.path ?? ''}\n${row.skill.name}`));
}

export interface RowSelection {
  /** Skills other accounts have that `agent` doesn't; empty in the All view. */
  missing: Row[];
  /** What is listed, after the search. */
  rows: Row[];
  groups: { source: SkillSource | 'other'; rows: Row[] }[];
  /** Listed rows Make global can apply to. */
  eligible: Row[];
  /** Every skill across accounts, before any filter: the All view's count. */
  allCount: number;
}

export function selectRows({
  catalogs,
  accounts,
  scope,
  agent,
  missingOnly,
  search,
}: {
  catalogs: SkillCatalogs;
  /** Runnable accounts, in the page's order. */
  accounts: Account[];
  scope: Scope;
  /** The one account shown, or the current one in the All view. */
  agent: AgentKind;
  missingOnly: boolean;
  search: string;
}): RowSelection {
  const catalog = skillsFor(catalogs, agent);
  const missing =
    scope === ALL
      ? []
      : dedupe(
          accounts
            .filter((account) => account.id !== agent)
            .flatMap((account) =>
              missingSkills(skillsFor(catalogs, account.id), catalog).map((skill) => ({
                skill,
                owner: account.id,
                in: [account.id],
              })),
            ),
        );
  const across: Row[] = skillsAcross(catalogs).map((item) => ({
    skill: item.skill,
    owner: item.in[0] as AgentKind,
    in: item.in,
  }));
  let base: Row[];
  if (scope === ALL) base = across;
  else if (missingOnly) base = missing;
  else base = catalog.skills.map((skill) => ({ skill, owner: agent, in: [agent] }));
  const rows = filterRows(base, search);
  const groups = SOURCE_ORDER.map((source) => ({
    source,
    rows: rows.filter((row) => (row.skill.source ?? 'other') === source),
  })).filter((group) => group.rows.length);
  const eligible = rows.filter((row) => canMakeGlobal(row.skill, catalogs, accounts));
  return { missing, rows, groups, eligible, allCount: across.length };
}
