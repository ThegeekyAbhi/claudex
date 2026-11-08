import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import type { Launcher } from '../application/sessions/session-manager';
import { runProvider } from '../providers/spawn';
import {
  type AgentProfile,
  type AgentSetup,
  BUILTIN_PROFILES,
  findProfile,
  LEGACY_SECOND_CLAUDE,
  orderProfiles,
  type Provider,
  parseProfileSettings,
  setProfiles,
} from '../shared/model';
import {
  describeMissing,
  envFor,
  expandHome,
  findExecutable,
  launchProfile,
  locateExecutable,
  resolveExecutable,
  suggestFolders,
} from './agent-paths';

export { expandHome, HOME_ENV, profileHome } from './agent-paths';

function settings() {
  return vscode.workspace.getConfiguration('agentWorkspace');
}
/** The path setting, or the bare command name. */
function configuredExecutable(provider: Provider): string {
  return settings().get<string>(`${provider}Path`, provider) || provider;
}
/** The CLI binary a provider uses, from its path setting or the PATH. */
function baseExecutable(provider: Provider): string {
  const configured = configuredExecutable(provider);
  return resolveExecutable(configured) ?? configured;
}
function userValue(inspected?: {
  globalValue?: string;
  workspaceValue?: string;
}): string | undefined {
  // An untrusted folder's settings must not choose which program runs or where it keeps history.
  return (
    (vscode.workspace.isTrusted ? inspected?.workspaceValue : undefined) ?? inspected?.globalValue
  );
}
/**
 * The second Claude account from before profiles. Shell aliases are invisible to VS Code, so it is
 * a `claud2`/`claude2` wrapper if one exists, else Claude Code with the old folder setting. It is
 * only listed when something says it's in use, so nobody without a second account sees it.
 */
function legacySecondClaude(savedIds: string[]): AgentProfile | undefined {
  const config = settings();
  const explicitPath = userValue(config.inspect<string>('claud2Path'));
  const explicitDir = userValue(config.inspect<string>('claud2ConfigDir'));
  const wrapper = explicitPath
    ? resolveExecutable(explicitPath)
    : (findExecutable('claud2') ?? findExecutable('claude2'));
  const used = savedIds.includes(LEGACY_SECOND_CLAUDE);
  if (!wrapper && !explicitPath && !explicitDir && !used) return undefined;
  return {
    id: LEGACY_SECOND_CLAUDE,
    label: 'Claude 2',
    provider: 'claude',
    legacy: true,
    // A wrapper picks its own folder, exactly as when you run it in a shell.
    ...(wrapper || explicitPath
      ? { executable: wrapper ?? explicitPath }
      : { homeDir: explicitDir ?? '~/.claude-account2' }),
  };
}
/** The old folder setting, for reading a wrapper's history: the wrapper sets it, so nothing here knows it. */
export function legacyHistoryDir(profile: AgentProfile): string | undefined {
  if (profile.id !== LEGACY_SECOND_CLAUDE || !profile.legacy || profile.homeDir) return undefined;
  return expandHome(
    userValue(settings().inspect<string>('claud2ConfigDir')) ?? '~/.claude-account2',
  );
}
/** Every profile, before checking the machine: built-ins, the setting, and the old second Claude. */
function configuredProfiles(savedIds: string[]): { profiles: AgentProfile[]; problems: string[] } {
  const { profiles, problems } = parseProfileSettings(settings().get('profiles'));
  const legacy = profiles.some((profile) => profile.id === LEGACY_SECOND_CLAUDE)
    ? undefined
    : legacySecondClaude(savedIds);
  return {
    profiles: orderProfiles([...BUILTIN_PROFILES, ...profiles, ...(legacy ? [legacy] : [])]),
    problems,
  };
}
/** The first line `--version` prints, or nothing when the CLI can't run or doesn't succeed. */
async function cliVersion(
  executable: string,
  env?: Record<string, string>,
): Promise<string | undefined> {
  try {
    const result = await runProvider(executable, ['--version'], { timeoutMs: 8000, env });
    if (result.code !== 0) return undefined;
    return result.stdout.trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}
/** Checks a profile can start: its CLI runs and its folder exists. Nothing is installed or made. */
async function check(profile: AgentProfile): Promise<AgentProfile> {
  const command = profile.executable ?? configuredExecutable(profile.provider);
  const search = locateExecutable(command);
  const located = search.found;
  const cli = profile.provider === 'claude' ? 'Claude Code' : 'Codex';
  if (!located)
    return {
      ...profile,
      status: 'missingCli',
      problem:
        describeMissing(command, search) ??
        (profile.executable
          ? `${profile.executable} wasn’t found.`
          : `${cli} isn’t installed, or isn’t on the PATH VS Code sees.`),
    };
  const found = { executablePath: located.path, executableOrigin: located.origin };
  if (profile.homeDir && !existsSync(expandHome(profile.homeDir)))
    return {
      ...profile,
      ...found,
      status: 'missingFolder',
      problem: `The folder ${profile.homeDir} doesn’t exist.`,
    };
  const version = await cliVersion(located.path, envFor(profile));
  if (!version)
    return { ...profile, ...found, status: 'missingCli', problem: `${located.path} didn’t run.` };
  return { ...profile, ...found, status: 'ready', version };
}
/** The agents this machine has. Sets the shared list, so labels and mentions follow it. */
export async function detectAgents(savedIds: string[]): Promise<AgentSetup> {
  const { profiles, problems } = configuredProfiles(savedIds);
  setProfiles(profiles);
  const checked = await Promise.all(profiles.map(check));
  setProfiles(checked);
  return { profiles: checked, problems, suggestions: suggestFolders(checked) };
}
/** Profiles from settings only, without running anything, for use before detection finishes. */
export function knownProfiles(savedIds: string[]): AgentProfile[] {
  return configuredProfiles(savedIds).profiles;
}
/** How to start a profile's CLI, or why it can't start. */
export function launcherFor(provider: Provider, profileId?: string): Launcher {
  const id = profileId ?? provider;
  return launchProfile(findProfile(id), provider, id, baseExecutable);
}
