import type { Provider } from './agents';
import type { AgentAuth, AgentProfile } from './profiles';
import type { AgentSetup } from './session';

/**
 * What first-run setup can truthfully say about an agent. Whether it is signed in comes from the
 * CLI's own status command (`auth`); this extension never reads credentials itself.
 */
export type SetupState = 'checking' | 'installed' | 'missingCli' | 'missingFolder';
export interface SetupRow {
  id: string;
  label: string;
  provider: Provider;
  state: SetupState;
  version?: string;
  problem?: string;
  /** Only for installed agents, once the CLI has answered. */
  auth?: AgentAuth;
}
export const INSTALL_HELP: Record<Provider, { name: string; command: string; docs: string }> = {
  claude: {
    name: 'Claude Code',
    command: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  },
  codex: {
    name: 'Codex',
    command: 'npm install -g @openai/codex',
    docs: 'https://github.com/openai/codex',
  },
};
/** Ideas that fill the composer. Nothing is sent until you press Enter. */
export const STARTER_PROMPTS = [
  'Explain how this project is structured and where its entry points are.',
  'Review my uncommitted changes and point out bugs or risks.',
  'Suggest three small improvements to this codebase, naming the files involved.',
];

function rowState(profile: AgentProfile): SetupState {
  if (profile.status === undefined) return 'checking';
  return profile.status === 'ready' ? 'installed' : profile.status;
}
/** Both built-in agents always, then any profiles you added. */
export function setupRows(agents?: AgentSetup): SetupRow[] {
  const profiles = agents?.profiles ?? [];
  const builtins: Provider[] = ['claude', 'codex'];
  const rows = builtins.map((provider): SetupRow => {
    const profile = profiles.find((item) => item.builtin && item.provider === provider);
    return profile
      ? toRow(profile, INSTALL_HELP[provider].name)
      : { id: provider, label: INSTALL_HELP[provider].name, provider, state: 'checking' };
  });
  for (const profile of profiles) if (!profile.builtin) rows.push(toRow(profile, profile.label));
  return rows;
}
function toRow(profile: AgentProfile, label: string): SetupRow {
  return {
    id: profile.id,
    label,
    provider: profile.provider,
    state: rowState(profile),
    ...(profile.version ? { version: profile.version } : {}),
    ...(profile.problem ? { problem: profile.problem } : {}),
    ...(profile.auth && profile.status === 'ready' ? { auth: profile.auth } : {}),
  };
}
/** No agent can start: every one has been checked and none is installed. */
export function noAgentInstalled(rows: SetupRow[]): boolean {
  return (
    rows.length > 0 && rows.every((row) => row.state !== 'checking' && row.state !== 'installed')
  );
}
/** Installed, and its CLI said it is signed out. Unknown or unchecked never counts. */
export function needsSignIn(row: SetupRow): boolean {
  return row.state === 'installed' && row.auth?.state === 'signedOut';
}
/**
 * What the empty workspace shows:
 * - `install`: nothing can start yet, so this shows even when dismissed or with threads.
 * - `signIn`: every installed agent says it is signed out. Dismissing skips it.
 * - `ready`: an agent can start; a short greeting with starter prompts.
 * - `hidden`: this workspace already has threads.
 */
export type OnboardingStage = 'install' | 'signIn' | 'ready' | 'hidden';
export function onboardingStage(input: {
  threads: number;
  dismissed: boolean;
  rows: SetupRow[];
}): OnboardingStage {
  if (noAgentInstalled(input.rows)) return 'install';
  if (input.threads > 0) return 'hidden';
  const installed = input.rows.filter((row) => row.state === 'installed');
  if (!input.dismissed && installed.length && installed.every(needsSignIn)) return 'signIn';
  return 'ready';
}
