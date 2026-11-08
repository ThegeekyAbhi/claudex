import { z } from 'zod';
import type { Provider } from './agents';

/**
 * A profile is one installed CLI plus, optionally, its own home folder: CLAUDE_CONFIG_DIR for
 * Claude Code, CODEX_HOME for Codex. Settings, skills, plugins, MCP servers, sign-in and session
 * history all live in that folder, so two profiles of one CLI are two separate accounts.
 */
export interface AgentProfile {
  /** Fixed handle used in @mentions, run_agent and saved threads. Renaming never changes it. */
  id: string;
  label: string;
  provider: Provider;
  /** The CLI's home folder. Unset means the CLI's own default (~/.claude or ~/.codex). */
  homeDir?: string;
  /** An executable to run instead of the detected CLI. */
  executable?: string;
  /** `claude` and `codex`: always listed, whether or not they're installed. */
  builtin?: boolean;
  /** Comes from the old second-Claude settings and isn't in `agentWorkspace.profiles` yet. */
  legacy?: boolean;
  /** What the host found on this machine. Unset until it has looked. */
  status?: ProfileStatus;
  version?: string;
  /** The program that runs, once found, and how it was found. Never holds credentials. */
  executablePath?: string;
  executableOrigin?: 'setting' | 'path' | 'knownFolder';
  /** Why the profile can't run, in words for the user. */
  problem?: string;
}
export type ProfileStatus = 'ready' | 'missingCli' | 'missingFolder';

/** Lowercase so a mention is typed the same way every time. */
export const PROFILE_ID = /^[a-z][a-z0-9-]{0,23}$/;
export const BUILTIN_PROFILES: AgentProfile[] = [
  { id: 'claude', label: 'Claude', provider: 'claude', builtin: true },
  { id: 'codex', label: 'Codex', provider: 'codex', builtin: true },
];
/** The id the second Claude account had before profiles existed. Saved threads still use it. */
export const LEGACY_SECOND_CLAUDE = 'claud2';
/** Mentions people already type for the old second Claude account. */
const LEGACY_ALIASES: Record<string, string> = { claude2: LEGACY_SECOND_CLAUDE };

/** One entry of the `agentWorkspace.profiles` setting. */
export const profileSettingSchema = z.object({
  id: z
    .string()
    .regex(PROFILE_ID, 'Use lowercase letters, digits and dashes, starting with a letter.'),
  name: z.string().trim().min(1).max(60),
  provider: z.enum(['claude', 'codex']),
  configDir: z.string().trim().min(1).max(4096).optional(),
  executable: z.string().trim().min(1).max(4096).optional(),
});
export type ProfileSetting = z.infer<typeof profileSettingSchema>;

/** Reads the setting. A bad entry is skipped and named, so one typo can't hide every profile. */
export function parseProfileSettings(raw: unknown): {
  profiles: AgentProfile[];
  problems: string[];
} {
  if (raw === undefined || raw === null) return { profiles: [], problems: [] };
  if (!Array.isArray(raw))
    return { profiles: [], problems: ['agentWorkspace.profiles must be a list.'] };
  const profiles: AgentProfile[] = [];
  const problems: string[] = [];
  const taken = new Set(BUILTIN_PROFILES.map((profile) => profile.id));
  raw.forEach((entry, index) => {
    const parsed = profileSettingSchema.safeParse(entry);
    if (!parsed.success) {
      const where = typeof entry?.id === 'string' ? `“${entry.id}”` : `#${index + 1}`;
      problems.push(`Profile ${where}: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
      return;
    }
    const value = parsed.data;
    if (taken.has(value.id)) {
      problems.push(
        BUILTIN_PROFILES.some((profile) => profile.id === value.id)
          ? `Profile “${value.id}”: that id belongs to the built-in ${value.id}.`
          : `Profile “${value.id}” is listed twice; only the first is used.`,
      );
      return;
    }
    taken.add(value.id);
    profiles.push({
      id: value.id,
      label: value.name,
      provider: value.provider,
      ...(value.configDir ? { homeDir: value.configDir } : {}),
      ...(value.executable ? { executable: value.executable } : {}),
    });
  });
  return { profiles, problems };
}
/** Built-ins first within each CLI, Claude's profiles before Codex's, as the rail shows them. */
export function orderProfiles(profiles: AgentProfile[]): AgentProfile[] {
  const rank = (profile: AgentProfile) =>
    (profile.provider === 'claude' ? 0 : 2) + (profile.builtin ? 0 : 1);
  return profiles
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) => rank(a.profile) - rank(b.profile) || a.index - b.index)
    .map(({ profile }) => profile);
}
/** A short handle from a name, for the Add profile form. */
export function profileIdFrom(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/-+$/, '')
      .slice(0, 20) || 'agent';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

// The current list, shared by everything that names an agent. The host sets it from settings and
// detection; the webview sets it from each snapshot. Both start from the built-ins.
let current: AgentProfile[] = BUILTIN_PROFILES;
export function setProfiles(profiles: AgentProfile[]): void {
  current = profiles.length ? profiles : BUILTIN_PROFILES;
}
export function allProfiles(): AgentProfile[] {
  return current;
}
export function findProfile(id: string): AgentProfile | undefined {
  return current.find((profile) => profile.id === id);
}
/** Profiles that can start a turn right now. */
export function runnableProfiles(): AgentProfile[] {
  return current.filter(canRun);
}
export function canRun(profile: AgentProfile): boolean {
  return profile.status === undefined || profile.status === 'ready';
}
export function profileLabel(id: string): string {
  return findProfile(id)?.label ?? (id === LEGACY_SECOND_CLAUDE ? 'Claude 2' : id);
}
/** The adapter an id runs on. Unknown ids fall back by name only so the view can still draw. */
export function profileProvider(id: string): Provider {
  return findProfile(id)?.provider ?? (id.startsWith('codex') ? 'codex' : 'claude');
}
/** What a typed @name means: a profile id, or an old alias of one that still exists. */
export function resolveAgentName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (findProfile(lower)) return lower;
  const alias = LEGACY_ALIASES[lower];
  return alias && findProfile(alias) ? alias : undefined;
}
/** Every name a mention may use, longest first so `claude2` wins over `claude`. */
export function mentionNames(): string[] {
  const names = current.map((profile) => profile.id);
  for (const [alias, target] of Object.entries(LEGACY_ALIASES))
    if (!names.includes(alias) && names.includes(target)) names.push(alias);
  return names.sort((a, b) => b.length - a.length);
}
