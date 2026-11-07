import type { Provider } from './agents';
import type { AgentProfile } from './profiles';
import type { AgentSetup } from './session';

/**
 * What first-run setup can truthfully say about an agent. Installed is as far as it goes:
 * whether you are signed in lives in the CLI's own credentials, which this extension never reads.
 */
export type SetupState = 'checking' | 'installed' | 'missingCli' | 'missingFolder';
export interface SetupRow {
  id: string;
  label: string;
  provider: Provider;
  state: SetupState;
  version?: string;
  problem?: string;
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
  };
}
/** No agent can start: every one has been checked and none is installed. */
export function noAgentInstalled(rows: SetupRow[]): boolean {
  return (
    rows.length > 0 && rows.every((row) => row.state !== 'checking' && row.state !== 'installed')
  );
}
/**
 * The setup card shows until this workspace has a thread, unless you dismissed it. It always
 * shows while no agent is installed, because nothing else here works until one is.
 */
export function showSetupCard(input: {
  threads: number;
  dismissed: boolean;
  rows: SetupRow[];
}): boolean {
  if (noAgentInstalled(input.rows)) return true;
  return input.threads === 0 && !input.dismissed;
}
