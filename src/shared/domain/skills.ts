import type { AgentKind } from './agents';

/** Only what a CLI says. Claude's list names no source or file, so those stay unset for it. */
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
  enabled: boolean;
}
export interface SkillCatalog {
  status: 'idle' | 'loading' | 'ready' | 'error';
  skills: Skill[];
  /** Skills the CLI found but couldn't read, such as a malformed SKILL.md. */
  problems: string[];
  error?: string;
}
export type SkillCatalogs = Record<AgentKind, SkillCatalog>;
export const emptySkills: SkillCatalogs = {};
const NOT_LISTED: SkillCatalog = { status: 'idle', skills: [], problems: [] };
/** A profile's skills. A profile not listed yet has none known, not an error. */
export function skillsFor(catalogs: SkillCatalogs, agent: AgentKind): SkillCatalog {
  return catalogs[agent] ?? NOT_LISTED;
}
/**
 * Personal skills one profile has and another of the same CLI doesn't. Each profile keeps its own
 * skills folder, so this is what someone switching accounts would find missing. Only what the CLIs
 * reported is compared; nothing reads or writes skill folders.
 */
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
/** Enabled skills matching a search, best matches first. */
export function searchSkills(skills: Skill[], query: string): Skill[] {
  const needle = query.toLowerCase();
  const enabled = skills.filter((skill) => skill.enabled);
  if (!needle) return enabled;
  const score = (skill: Skill) => {
    const name = skill.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    return skill.description.toLowerCase().includes(needle) ? 2 : 3;
  };
  return enabled
    .map((skill) => ({ skill, rank: score(skill) }))
    .filter((item) => item.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.skill);
}
