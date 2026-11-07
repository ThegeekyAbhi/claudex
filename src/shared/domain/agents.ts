import { profileLabel, profileProvider } from './profiles';

export type Provider = 'codex' | 'claude';
/** One launchable agent: the adapter it runs on, and which profile of that CLI. */
export interface AgentRef {
  provider: Provider;
  /** Unset on threads saved before profiles: those are the built-in profile of their provider. */
  profileId?: string;
}
/** A profile id: `claude`, `codex`, or one the user added. */
export type AgentKind = string;
export function agentKind(session: AgentRef): AgentKind {
  return session.profileId ?? session.provider;
}
export function agentLabel(session: AgentRef): string {
  return profileLabel(agentKind(session));
}
export function agentTarget(agent: AgentKind): { provider: Provider; profileId: string } {
  return { provider: profileProvider(agent), profileId: agent };
}
export const AGENT_MODES = ['ask', 'plan', 'auto'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];
export type Status = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted';
export const TERMINAL_STATUSES: Status[] = ['completed', 'failed', 'interrupted'];
