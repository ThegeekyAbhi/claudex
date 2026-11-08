import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
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

/** Where a CLI was found, so the user can be told which one runs. */
export type ExecutableOrigin = 'setting' | 'path' | 'knownFolder';
export interface LocatedExecutable {
  path: string;
  origin: ExecutableOrigin;
  /**
   * `launcher` is a script that starts the real program, such as npm's `codex.cmd` on Windows or a
   * `#!` script elsewhere. `native` is anything else.
   */
  kind: 'native' | 'launcher';
}
/** A file that was found but can't be run, kept so the user hears why rather than “not found”. */
export interface RejectedExecutable {
  path: string;
  reason: 'folder' | 'notExecutable';
}
export interface ExecutableSearch {
  found?: LocatedExecutable;
  rejected: RejectedExecutable[];
}
/** What the search needs from the machine; tests pass their own. */
export interface SearchHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** What is at a path: a runnable file, a file without run permission, a folder, or nothing. */
  probe: (file: string) => 'runnable' | 'notExecutable' | 'folder' | undefined;
  /** Whether a file starts with `#!`, which makes it a launcher script. */
  isScript: (file: string) => boolean;
}

function probeFile(platform: NodeJS.Platform) {
  return (file: string): 'runnable' | 'notExecutable' | 'folder' | undefined => {
    let info: ReturnType<typeof statSync>;
    try {
      info = statSync(file);
    } catch {
      return undefined;
    }
    if (info.isDirectory()) return 'folder';
    if (!info.isFile()) return undefined;
    // Windows decides by extension, which the search already chose.
    if (platform === 'win32') return 'runnable';
    try {
      accessSync(file, constants.X_OK);
      return 'runnable';
    } catch {
      return 'notExecutable';
    }
  };
}
function startsWithShebang(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(2);
    return readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === '#!';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function defaultSearchHost(): SearchHost {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    probe: probeFile(process.platform),
    isScript: startsWithShebang,
  };
}
/** An environment variable, by name regardless of case on Windows, as Windows itself reads it. */
function envValue(host: SearchHost, name: string): string | undefined {
  if (host.platform !== 'win32') return host.env[name] || undefined;
  const key = Object.keys(host.env).find((item) => item.toUpperCase() === name.toUpperCase());
  return (key && host.env[key]) || undefined;
}
/**
 * Where official installers and common package managers put CLIs. VS Code started from the Dock,
 * Start menu or a desktop launcher often has a shorter PATH than a terminal, so these are checked
 * after PATH. Nothing is run to find them: shell startup files are never executed.
 */
export function knownFolders(host: SearchHost): string[] {
  const p = host.platform === 'win32' ? path.win32 : path.posix;
  const home = host.home;
  const env = (name: string) => envValue(host, name);
  const folders: (string | undefined)[] =
    host.platform === 'win32'
      ? [
          // Claude Code's native installer.
          p.join(home, '.local', 'bin'),
          // npm's global folder, where `npm install -g @openai/codex` puts codex.cmd.
          env('APPDATA') && p.join(env('APPDATA') as string, 'npm'),
          env('PNPM_HOME'),
          env('LOCALAPPDATA') && p.join(env('LOCALAPPDATA') as string, 'pnpm'),
          env('LOCALAPPDATA') &&
            p.join(env('LOCALAPPDATA') as string, 'Microsoft', 'WinGet', 'Links'),
          env('LOCALAPPDATA') && p.join(env('LOCALAPPDATA') as string, 'Volta', 'bin'),
          p.join(home, 'scoop', 'shims'),
          p.join(home, '.bun', 'bin'),
          p.join(home, '.cargo', 'bin'),
        ]
      : [
          // Claude Code's native installer.
          p.join(home, '.local', 'bin'),
          ...(host.platform === 'darwin'
            ? ['/opt/homebrew/bin', '/usr/local/bin', p.join(home, 'Library', 'pnpm')]
            : [
                '/usr/local/bin',
                '/home/linuxbrew/.linuxbrew/bin',
                p.join(home, '.linuxbrew', 'bin'),
                p.join(home, '.local', 'share', 'pnpm'),
              ]),
          env('PNPM_HOME'),
          p.join(home, '.npm-global', 'bin'),
          p.join(home, '.volta', 'bin'),
          p.join(home, '.bun', 'bin'),
          p.join(home, '.cargo', 'bin'),
          '/usr/bin',
        ];
  return [...new Set(folders.filter((folder): folder is string => Boolean(folder)))];
}
/**
 * File names to try for a command. On Windows a bare name is never run: npm puts a POSIX shell
 * script named plain `codex` beside `codex.cmd`, and Windows can't run it. A native .exe comes
 * before a .cmd/.bat launcher; other PATHEXT entries such as .js or .ps1 aren't programs Node can
 * start.
 */
export function candidateNames(command: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return [command];
  if (/\.(exe|cmd|bat|com)$/i.test(command)) return [command];
  return ['.exe', '.cmd', '.bat', '.com'].map((ext) => `${command}${ext}`);
}
function kindOf(file: string, host: SearchHost): LocatedExecutable['kind'] {
  if (host.platform === 'win32') return /\.(cmd|bat)$/i.test(file) ? 'launcher' : 'native';
  return host.isScript(file) ? 'launcher' : 'native';
}
/**
 * Finds a CLI. An absolute path (or `~/…`) is checked as given; a name is searched on PATH, then
 * in the folders installers use. Every path is checked to be a runnable file, not just to exist.
 */
export function locateExecutable(
  command: string,
  host: SearchHost = defaultSearchHost(),
): ExecutableSearch {
  const p = host.platform === 'win32' ? path.win32 : path.posix;
  const rejected: RejectedExecutable[] = [];
  const check = (file: string, origin: ExecutableOrigin): LocatedExecutable | undefined => {
    const state = host.probe(file);
    if (state === 'runnable') return { path: file, origin, kind: kindOf(file, host) };
    if (state === 'folder' || state === 'notExecutable')
      rejected.push({ path: file, reason: state === 'folder' ? 'folder' : 'notExecutable' });
    return undefined;
  };
  const expanded = /^~(?=$|[/\\])/.test(command) ? command.replace(/^~/, host.home) : command;
  if (p.isAbsolute(expanded)) {
    for (const name of candidateNames(p.normalize(expanded), host.platform)) {
      const found = check(name, 'setting');
      if (found) return { found, rejected };
    }
    return { rejected };
  }
  const searchPath = (envValue(host, 'PATH') ?? '').split(p.delimiter).filter(Boolean);
  const folders: [string, ExecutableOrigin][] = [
    ...searchPath.map((folder): [string, ExecutableOrigin] => [folder, 'path']),
    ...knownFolders(host).map((folder): [string, ExecutableOrigin] => [folder, 'knownFolder']),
  ];
  const seen = new Set<string>();
  for (const [folder, origin] of folders) {
    // A relative PATH entry depends on whatever folder the extension host started in.
    if (!p.isAbsolute(folder)) continue;
    const key = host.platform === 'win32' ? folder.toLowerCase() : folder;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const name of candidateNames(command, host.platform)) {
      const found = check(p.join(folder, name), origin);
      if (found) return { found, rejected };
    }
  }
  return { rejected };
}
/** PATH, then where installers usually put CLIs, since VS Code's PATH can miss shell setup. */
export function findExecutable(command: string): string | undefined {
  return locateExecutable(command).found?.path;
}
export function expandHome(folder: string, home = homedir()): string {
  return path.resolve(folder.replace(/^~(?=$|[/\\])/, home));
}
export function resolveExecutable(command: string): string | undefined {
  return findExecutable(command);
}
/** Why a CLI couldn't be used, in words for the user, from what the search turned up. */
export function describeMissing(command: string, search: ExecutableSearch): string | undefined {
  const first = search.rejected[0];
  if (!first) return undefined;
  return first.reason === 'folder'
    ? `${first.path} is a folder, not the ${command} program.`
    : `${first.path} isn’t allowed to run. Make it executable (chmod +x) or reinstall ${command}.`;
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
