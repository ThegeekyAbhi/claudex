/** `cursor` recolours dark editor themes. `editor` follows the active VS Code theme throughout. */
export const APPEARANCES = ['cursor', 'editor'] as const;
export type Appearance = (typeof APPEARANCES)[number];
/** How much of a thread goes with it when you continue it in another agent. `off` sends none. */
export const CROSS_AGENT_CONTEXT = ['recent', 'full', 'off'] as const;
export type CrossAgentContext = (typeof CROSS_AGENT_CONTEXT)[number];
export interface Preferences {
  appearance: Appearance;
  /** Sends the planning guide with Plan mode messages. */
  guidedPlanning: boolean;
  /** Sends the explanation guide with Ask mode messages. */
  richExplanations: boolean;
  crossAgentContext: CrossAgentContext;
}
export const DEFAULT_PREFERENCES: Preferences = {
  appearance: 'cursor',
  guidedPlanning: true,
  richExplanations: true,
  crossAgentContext: 'recent',
};
export function parseCrossAgentContext(value: unknown): CrossAgentContext {
  return CROSS_AGENT_CONTEXT.includes(value as CrossAgentContext)
    ? (value as CrossAgentContext)
    : DEFAULT_PREFERENCES.crossAgentContext;
}
export function parseAppearance(value: unknown): Appearance {
  return APPEARANCES.includes(value as Appearance)
    ? (value as Appearance)
    : DEFAULT_PREFERENCES.appearance;
}
