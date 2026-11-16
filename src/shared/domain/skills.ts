import type { AgentKind } from './agents';
import { runnableProfiles } from './profiles';

/** Disk provenance and native availability are separate observations. */
export type SkillSource = 'project' | 'personal' | 'plugin' | 'system' | 'admin';
export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  project: 'Project',
  personal: 'Personal',
  plugin: 'Plugin',
  system: 'System',
  admin: 'Admin',
};
export interface Skill {
  name: string;
  description: string;
  source?: SkillSource;
  path?: string;
  argumentHint?: string;
  enabled: boolean | null;
  evidence?: 'disk' | 'native';
  /** On disk, its real folder is in the global folder (`~/.agents/skills`), shared by accounts. */
  global?: boolean;
}
export interface SkillCatalog {
  status: 'idle' | 'loading' | 'ready' | 'error';
  skills: Skill[];
  /** Discovery problems, including incomplete scans and unsupported metadata. */
  problems: string[];
  error?: string;
  stale?: boolean;
  cwd?: string;
}
export type SkillCatalogs = Record<AgentKind, SkillCatalog>;
export const emptySkills: SkillCatalogs = {};
const NOT_LISTED: SkillCatalog = { status: 'idle', skills: [], problems: [] };
/** A profile's skills. A profile not listed yet has none known, not an error. */
export function skillsFor(catalogs: SkillCatalogs, agent: AgentKind): SkillCatalog {
  return catalogs[agent] ?? NOT_LISTED;
}
/** Compares observed names only; it does not establish equivalent contents or profile isolation. */
export function missingSkills(from: SkillCatalog, to: SkillCatalog): Skill[] {
  if (from.status !== 'ready' || to.status !== 'ready') return [];
  const names = new Set(to.skills.map((skill) => skill.name));
  return from.skills.filter(
    (skill) => skill.source !== 'project' && skill.source !== 'system' && !names.has(skill.name),
  );
}
export interface SkillRequest {
  name: string;
  path?: string;
}
/** Same name from two sources is two skills, so identity includes the file when there is one. */
export function sameSkill(a: SkillRequest, b: SkillRequest): boolean {
  return a.name === b.name && (a.path ?? '') === (b.path ?? '');
}
/** 0 for a name starting with the search, 1 for a name containing it, 2 for a description; 3 is no match. */
function matchRank(skill: Skill, needle: string): number {
  const name = skill.name.toLowerCase();
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (skill.description.toLowerCase().includes(needle)) return 2;
  return 3;
}
/** Selectable skill requests: disk findings remain unverified until checked natively. */
export function searchSkills(skills: Skill[], query: string): Skill[] {
  const needle = query.toLowerCase();
  const enabled = skills.filter((skill) => skill.enabled !== false);
  if (!needle) return enabled;
  return enabled
    .map((skill) => ({ skill, rank: matchRank(skill, needle) }))
    .filter((item) => item.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.skill);
}
/** A skill found in another account, offered to borrow. */
export interface ForeignSkill {
  skill: Skill;
  /** The account it is read from. */
  from: AgentKind;
  /** Every other account with a skill of the same name. */
  alsoIn: AgentKind[];
}
/** The same skill seen through several accounts: one file, or one name when there's no file. */
export function skillKey(skill: Skill): string {
  // Accounts reach one global skill through their own links, so its paths differ by account.
  if (skill.global) return `global:${skill.name}`;
  return skill.path ? `path:${skill.path}` : `name:${skill.name}`;
}
/**
 * Matches in the other runnable accounts that this one doesn't have, one per skill name.
 * Only skills with a file can be borrowed, because their instructions are what gets sent.
 */
export function searchOtherSkills(
  catalogs: SkillCatalogs,
  agent: AgentKind,
  query: string,
): ForeignSkill[] {
  const own = skillsFor(catalogs, agent).skills;
  const ownNames = new Set(
    own.filter((skill) => skill.enabled !== false).map((skill) => skill.name),
  );
  const ownPaths = new Set(own.flatMap((skill) => (skill.path ? [skill.path] : [])));
  const found = new Map<string, ForeignSkill>();
  for (const profile of runnableProfiles()) {
    if (profile.id === agent) continue;
    for (const skill of searchSkills(skillsFor(catalogs, profile.id).skills, query)) {
      if (!skill.path || ownNames.has(skill.name) || ownPaths.has(skill.path)) continue;
      // One row per name: the same skill installed in several accounts is offered once, read
      // from the first account that has it.
      const key = skill.name;
      const seen = found.get(key);
      if (seen) seen.alsoIn.push(profile.id);
      else found.set(key, { skill, from: profile.id, alsoIn: [] });
    }
  }
  // searchSkills ranked within each account; rank again across them, then by name.
  const needle = query.toLowerCase();
  return [...found.values()].sort(
    (a, b) =>
      matchRank(a.skill, needle) - matchRank(b.skill, needle) ||
      a.skill.name.localeCompare(b.skill.name),
  );
}
/** One row per skill across every runnable account, with who has it. For the Skills page. */
export interface SkillAcross {
  skill: Skill;
  /** Accounts listing this skill, in profile order. The first is where it's read from. */
  in: AgentKind[];
}
export function skillsAcross(catalogs: SkillCatalogs): SkillAcross[] {
  const found = new Map<string, SkillAcross>();
  for (const profile of runnableProfiles()) {
    for (const skill of skillsFor(catalogs, profile.id).skills) {
      const key = skillKey(skill);
      const seen = found.get(key);
      if (seen) {
        if (!seen.in.includes(profile.id)) seen.in.push(profile.id);
      } else found.set(key, { skill, in: [profile.id] });
    }
  }
  return [...found.values()].sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}
