import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Launcher } from '../application/sessions/session-manager';
import type { AgentProfile, AgentSetup, Provider } from '../shared/model';

/** The variable each CLI reads for its home folder. */
export const HOME_ENV: Record<Provider, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};
const DEFAULT_HOME: Record<Provider, string> = { claude: '.claude', codex: '.codex' };

/** PATH, then where installers usually put CLIs, since VS Code's PATH can miss shell setup. */
export function findExecutable(command: string): string | undefined {
  if (path.isAbsolute(command)) return existsSync(command) ? command : undefined;
  for (const folder of (process.env.PATH ?? '')
    .split(path.delimiter)
    .concat([path.join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'])) {
    const candidate = path.join(folder, command);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
export function expandHome(folder: string, home = homedir()): string {
  return path.resolve(folder.replace(/^~(?=$|[/\\])/, home));
}
export function resolveExecutable(command: string): string | undefined {
  return findExecutable(command.startsWith('~') ? expandHome(command) : command);
}
/** Only a profile with its own folder changes the environment; the built-ins run untouched. */
export function envFor(profile: AgentProfile): Record<string, string> | undefined {
  return profile.homeDir
    ? { [HOME_ENV[profile.provider]]: expandHome(profile.homeDir) }
    : undefined;
}
/** A profile's home folder: its own, or the CLI's default. */
export function profileHome(profile: AgentProfile, home = homedir()): string {
  return expandHome(profile.homeDir ?? path.join(home, DEFAULT_HOME[profile.provider]), home);
}
/**
 * How to start a profile's CLI. A profile whose folder is gone fails here rather than quietly
 * running as the default account, which would show another account's history and skills.
 */
export function launchProfile(
  profile: AgentProfile | undefined,
  provider: Provider,
  id: string,
  baseExecutable: (provider: Provider) => string,
): Launcher {
  if (!profile) throw new Error(`There is no agent profile “${id}”. Add it again to use it.`);
  if (profile.provider !== provider)
    throw new Error(`The profile “${profile.label}” runs ${profile.provider}, not ${provider}.`);
  if (profile.homeDir && !existsSync(expandHome(profile.homeDir)))
    throw new Error(
      `The folder for “${profile.label}” (${profile.homeDir}) doesn’t exist. Fix it in Claudex’s agent menu.`,
    );
  const executable = profile.executable
    ? (resolveExecutable(profile.executable) ?? profile.executable)
    : baseExecutable(provider);
  const env = envFor(profile);
  return env ? { executable, env } : { executable };
}
/**
 * Folders beside ~/.claude and ~/.codex that look like another account, such as ~/.claude-work.
 * Only offered: nothing is added until you pick one.
 */
export function suggestFolders(
  profiles: AgentProfile[],
  home = homedir(),
): AgentSetup['suggestions'] {
  const used = new Set(profiles.map((profile) => profileHome(profile, home)));
  const marker: Record<Provider, string[]> = {
    claude: ['settings.json', '.claude.json', 'projects'],
    codex: ['config.toml', 'auth.json', 'sessions'],
  };
  let names: string[] = [];
  try {
    names = readdirSync(home).sort();
  } catch {
    return [];
  }
  const found: AgentSetup['suggestions'] = [];
  for (const name of names)
    for (const provider of ['claude', 'codex'] as const) {
      const base = DEFAULT_HOME[provider];
      if (!name.startsWith(`${base}-`) && !name.startsWith(`${base}_`)) continue;
      const folder = path.join(home, name);
      try {
        if (!statSync(folder).isDirectory() || used.has(folder)) continue;
      } catch {
        continue;
      }
      if (marker[provider].some((item) => existsSync(path.join(folder, item))))
        found.push({ provider, path: `~/${name}` });
    }
  return found;
}
