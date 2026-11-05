export type Provider = 'codex' | 'claude';
export type ClaudeCommand = 'claude' | 'claud2';
/** One launchable agent. `claud2` is the persisted id of the second Claude launcher. */
export interface AgentRef {
  provider: Provider;
  claudeCommand?: ClaudeCommand;
}
export type AgentKind = 'codex' | 'claude' | 'claud2';
export const AGENT_KINDS: AgentKind[] = ['codex', 'claude', 'claud2'];
export const AGENT_LABELS: Record<AgentKind, string> = {
  codex: 'Codex',
  claude: 'Claude',
  claud2: 'Claude 2',
};
export function agentKind(session: AgentRef): AgentKind {
  if (session.provider === 'codex') return 'codex';
  return session.claudeCommand === 'claud2' ? 'claud2' : 'claude';
}
export function agentLabel(session: AgentRef): string {
  return AGENT_LABELS[agentKind(session)];
}
export function agentTarget(agent: AgentKind): { provider: Provider; command?: ClaudeCommand } {
  return agent === 'codex' ? { provider: 'codex' } : { provider: 'claude', command: agent };
}
export const AGENT_MODES = ['ask', 'plan', 'agent', 'auto'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];
export type Status = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted';
export const TERMINAL_STATUSES: Status[] = ['completed', 'failed', 'interrupted'];
