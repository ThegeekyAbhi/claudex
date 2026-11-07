import type { Session } from '../../../shared/model';

export type MascotActivity =
  | 'working'
  | 'thinking'
  | 'planning'
  | 'coding'
  | 'reading'
  | 'attentive';

/** Presentation only: choose from current-turn evidence, never from a tool's success. */
export function mascotActivity(session: Session): MascotActivity | undefined {
  if (session.status === 'waiting') return 'attentive';
  if (session.status !== 'running' || session.transition) return undefined;
  if (session.approval) return 'attentive';
  const start = session.messages.map((message) => message.role).lastIndexOf('user');
  const current = session.messages.slice(start + 1);
  const tool = current
    .slice()
    .reverse()
    .find((message) => message.tool?.status === 'running')?.tool;
  if (tool) {
    if (tool.kind === 'edit') return 'coding';
    if (['read', 'search', 'web'].includes(tool.kind)) return 'reading';
    return 'working';
  }
  const last = current.at(-1);
  if (last?.role === 'thinking' && !last.endedAt) return 'thinking';
  if (session.mode === 'plan' || session.plan?.status === 'drafting') return 'planning';
  return 'working';
}

export const ACTIVITY_LABELS: Record<MascotActivity, string> = {
  working: 'Working…',
  thinking: 'Thinking…',
  planning: 'Planning…',
  coding: 'Coding…',
  reading: 'Reading / searching…',
  attentive: 'Waiting for your input',
};
