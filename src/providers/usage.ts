import type { UsageLimit } from '../core/model';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function windowLabel(minutes: unknown, fallback: string): string {
  if (!finite(minutes) || minutes <= 0) return fallback;
  if (minutes === 10_080) return 'Weekly';
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}
/** Codex reports two rolling windows. A missing one means "not in this update", never "reset". */
export function codexLimits(snapshot: any): UsageLimit[] {
  const limits: UsageLimit[] = [];
  for (const [id, fallback] of [
    ['primary', 'Short window'],
    ['secondary', 'Long window'],
  ] as const) {
    const window = snapshot?.[id];
    if (!finite(window?.usedPercent)) continue;
    limits.push({
      id,
      label: windowLabel(window.windowDurationMins, fallback),
      usedPercent: window.usedPercent,
      // Seconds since the epoch in this protocol.
      ...(finite(window.resetsAt) ? { resetsAt: window.resetsAt * 1000 } : {}),
    });
  }
  return limits;
}
const CLAUDE_WINDOWS: [string, string][] = [
  ['five_hour', '5-hour'],
  ['seven_day', 'Weekly'],
  ['seven_day_opus', 'Weekly Opus'],
  ['seven_day_sonnet', 'Weekly Sonnet'],
];
/** `utilization` is documented as 0-100 here. API key sessions have no plan limits and send null. */
export function claudeLimits(rateLimits: any): UsageLimit[] {
  const limits: UsageLimit[] = [];
  for (const [id, label] of CLAUDE_WINDOWS) {
    const window = rateLimits?.[id];
    if (!finite(window?.utilization)) continue;
    const resetsAt = typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN;
    limits.push({
      id,
      label,
      usedPercent: window.utilization,
      ...(Number.isNaN(resetsAt) ? {} : { resetsAt }),
    });
  }
  return limits;
}
/** Counts what this response occupied in the window, which is what the next one builds on. */
export function claudeContextTokens(usage: any): number | undefined {
  if (!finite(usage?.input_tokens)) return undefined;
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.output_tokens ?? 0)
  );
}
