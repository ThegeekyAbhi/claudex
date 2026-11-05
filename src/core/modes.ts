import { z } from 'zod';
import { AGENT_MODES, type AgentMode } from './agents';

export const agentModeEnum = z.enum(AGENT_MODES);

export const MODE_LABELS: Record<AgentMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  agent: 'Agent',
  auto: 'Auto',
};

/** ⇧Tab order. An unset mode counts as Agent, so the first press always lands somewhere visible. */
export function nextMode(mode: AgentMode | undefined): AgentMode {
  const index = AGENT_MODES.indexOf(mode ?? 'agent');
  return AGENT_MODES[(index + 1) % AGENT_MODES.length] ?? 'agent';
}

/**
 * What the composer shows. A mode the CLI reported wins, because a CLI can refuse a request
 * or apply its own default. Before any report: your choice, or Default when you made none.
 */
export function modeView(
  requested: AgentMode | undefined,
  reported: string | undefined,
): { label: string; mode?: AgentMode } {
  if (!reported)
    return requested ? { label: MODE_LABELS[requested], mode: requested } : { label: 'Default' };
  if (reported === 'default') return { label: 'Agent', mode: 'agent' };
  if (reported === 'plan') return { label: 'Plan', mode: 'plan' };
  if (reported === 'auto') return { label: 'Auto', mode: 'auto' };
  // Only our Ask pairs dontAsk with edit tools turned off, so your own dontAsk isn't called Ask.
  if (reported === 'dontAsk')
    return requested === 'ask' ? { label: 'Ask', mode: 'ask' } : { label: 'Don’t ask' };
  if (reported === 'acceptEdits') return { label: 'Accept edits' };
  if (reported === 'bypassPermissions') return { label: 'Bypass' };
  return { label: reported };
}
