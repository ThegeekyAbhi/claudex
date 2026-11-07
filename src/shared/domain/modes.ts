import { z } from 'zod';
import { AGENT_MODES, type AgentMode } from './agents';

export const agentModeEnum = z.enum(AGENT_MODES);

export const MODE_LABELS: Record<AgentMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  auto: 'Auto',
};

/** Reported for a Codex thread whose approval policy leaves Auto review nothing to do. */
export const CODEX_OWN_SETTINGS = 'codex-own-settings';
/** ⇧Tab order. An unset mode goes to Auto, so the first press always lands somewhere visible. */
export function nextMode(mode: AgentMode | undefined): AgentMode {
  if (!mode) return 'auto';
  return AGENT_MODES[(AGENT_MODES.indexOf(mode) + 1) % AGENT_MODES.length] ?? 'auto';
}
/** A new chat uses your last choice, or Auto. A choice saved before Agent was removed counts as none. */
export function newChatMode(stored: unknown): AgentMode {
  return AGENT_MODES.includes(stored as AgentMode) ? (stored as AgentMode) : 'auto';
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
  if (reported === 'default') return { label: 'Manual' };
  if (reported === CODEX_OWN_SETTINGS) return { label: 'Your Codex settings' };
  if (reported === 'plan') return { label: 'Plan', mode: 'plan' };
  if (reported === 'auto') return { label: 'Auto', mode: 'auto' };
  // Only our Ask pairs dontAsk with edit tools turned off, so your own dontAsk isn't called Ask.
  if (reported === 'dontAsk')
    return requested === 'ask' ? { label: 'Ask', mode: 'ask' } : { label: 'Don’t ask' };
  if (reported === 'acceptEdits') return { label: 'Accept edits' };
  if (reported === 'bypassPermissions') return { label: 'Bypass' };
  return { label: reported };
}
