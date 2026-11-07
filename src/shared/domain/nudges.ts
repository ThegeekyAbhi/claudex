import type { AgentKind, AgentMode } from './agents';
import { CODEX_OWN_SETTINGS, MODE_LABELS, modeView } from './modes';
import { profileLabel } from './profiles';
import type { Session } from './session';

export type Nudge =
  | { key: string; kind: 'handoff'; text: string }
  | { key: string; kind: 'mode'; text: string }
  | { key: string; kind: 'plan'; text: string };

const NEAR_LIMIT = 85;
function worstUsage(session: Session): number {
  const { context, limits } = session.usage ?? {};
  const contextUsed = context ? (context.used / context.max) * 100 : 0;
  const now = Date.now();
  return (limits ?? [])
    .filter((limit) => !limit.resetsAt || limit.resetsAt > now)
    .reduce((top, limit) => Math.max(top, limit.usedPercent), contextUsed);
}
/**
 * The most useful thing to say now, or nothing. There is never more than one, and dismissing
 * one is remembered, so the UI stays quiet unless there's something to act on.
 */
export function chooseNudge(
  session: Session | undefined,
  agent: AgentKind,
  requested: AgentMode | undefined,
  dismissed: readonly string[],
): Nudge | undefined {
  const options: Nudge[] = [];
  if (session && !session.observed && worstUsage(session) >= NEAR_LIMIT)
    options.push({
      key: `handoff:${session.id}`,
      kind: 'handoff',
      text: 'Close to a limit.',
    });
  // Your Codex settings already get a notice that says why, and a nudge couldn't add anything.
  if (session && requested && session.reportedMode && session.reportedMode !== CODEX_OWN_SETTINGS) {
    const actual = modeView(requested, session.reportedMode);
    if (actual.mode !== requested)
      options.push({
        key: `mode:${agent}:${requested}`,
        kind: 'mode',
        text: `${profileLabel(agent)} is running in ${actual.label}, not ${MODE_LABELS[requested]}.`,
      });
  }
  if (!session && (!requested || requested === 'auto'))
    options.push({ key: 'try-plan', kind: 'plan', text: 'Try Plan Mode' });
  return options.find((item) => !dismissed.includes(item.key));
}
