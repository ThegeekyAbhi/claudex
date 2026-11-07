import {
  type FileDiff,
  isAgentPlanFile,
  type Message,
  type Session,
  type ToolInfo,
} from '../../../shared/model';

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
const VERBS: Record<ToolInfo['kind'], [running: string, done: string]> = {
  command: ['Running', 'Ran'],
  read: ['Reading', 'Read'],
  edit: ['Editing', 'Edited'],
  search: ['Searching', 'Searched'],
  web: ['Fetching', 'Fetched'],
  agent: ['Running', 'Ran'],
  skill: ['Invoking skill', 'Used skill'],
  other: ['Calling', 'Called'],
};
/** An edit to Claude Code's own plan file. The plan card shows that plan. */
export function isPlanEdit(tool: ToolInfo | undefined): boolean {
  if (tool?.kind !== 'edit') return false;
  return tool.diffs?.length
    ? tool.diffs.every((diff) => isAgentPlanFile(diff.path))
    : isAgentPlanFile(tool.title);
}
export function verb(tool: ToolInfo): string {
  if (isPlanEdit(tool) && tool.status === 'completed') return 'Updated';
  const [running, done] =
    tool.skill?.phase === 'read' ? ['Reading skill', 'Read skill'] : VERBS[tool.kind];
  if (tool.status === 'interrupted') return 'Interrupted:';
  if (tool.status === 'running') return running;
  if (tool.status === 'failed') return `Failed: ${running.toLowerCase()}`;
  if (tool.status === 'declined') return `Declined: ${running.toLowerCase()}`;
  return done;
}
export function activitySummary(items: Message[]): string {
  const count = (kind: ToolInfo['kind']) =>
    items.filter((m) => m.tool?.kind === kind && !m.tool.diffSource && !isPlanEdit(m.tool)).length;
  const planned = items.some((m) => isPlanEdit(m.tool) && m.tool?.status === 'completed');
  const plural = (value: number, noun: string, many = `${noun}s`) =>
    `${value} ${value === 1 ? noun : many}`;
  const parts: string[] = [];
  if (planned) parts.push('wrote the plan');
  if (count('edit')) parts.push(`edited ${plural(count('edit'), 'file')}`);
  if (count('command')) parts.push(`ran ${plural(count('command'), 'command')}`);
  if (count('read')) parts.push(`read ${plural(count('read'), 'file')}`);
  if (count('search')) parts.push(`ran ${plural(count('search'), 'search', 'searches')}`);
  if (count('web')) parts.push(`fetched ${plural(count('web'), 'page')}`);
  if (count('skill')) parts.push(`invoked ${plural(count('skill'), 'skill')}`);
  if (count('other')) parts.push(`used ${plural(count('other'), 'tool')}`);
  // Threads from before tool details were recorded have only plain rows.
  const plain = items.filter((m) => m.role === 'tool' && !m.tool).length;
  if (plain) parts.push(`ran ${plural(plain, 'step')}`);
  if (!parts.length) return 'Thought it through';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}
export function diffsOf(items: Message[]): FileDiff[] {
  return items.flatMap((message) =>
    message.tool?.status === 'declined' ||
    message.tool?.status === 'failed' ||
    message.tool?.status === 'interrupted'
      ? []
      : (message.tool?.diffs ?? []).filter((diff) => !isAgentPlanFile(diff.path)),
  );
}
type Segment =
  | { type: 'message'; message: Message }
  | { type: 'activity'; items: Message[] }
  | { type: 'subagent'; message: Message };
function isSubagent(message: Message): boolean {
  return (
    message.tool?.kind === 'agent' &&
    ['delegate', 'run_agent', 'spawnAgent', 'Task', 'Agent'].includes(message.tool.name)
  );
}
export function segment(messages: Message[]): Segment[] {
  const segments: Segment[] = [];
  for (const message of messages) {
    // Observations remain in session history, but do not add duplicate change cards to chat.
    if (message.tool?.diffSource) continue;
    if (isSubagent(message)) segments.push({ type: 'subagent', message });
    else if (message.role === 'tool' || message.role === 'thinking') {
      const last = segments.at(-1);
      if (last?.type === 'activity') last.items.push(message);
      else segments.push({ type: 'activity', items: [message] });
    } else segments.push({ type: 'message', message });
  }
  return segments;
}
export function findChild(
  message: Message,
  parent: Session,
  sessions: Session[],
): Session | undefined {
  const id = message.tool?.workerId ?? message.id;
  return sessions.find(
    (item) => item.parentId === parent.id && (item.id === id || item.nativeId === id),
  );
}
export function segmentKey(item: ReturnType<typeof segment>[number]): string {
  return item.type === 'activity' ? item.items[0].id : item.message.id;
}
export function segmentHas(
  item: ReturnType<typeof segment>[number],
  id: string | undefined,
): boolean {
  if (!id) return false;
  return item.type === 'activity'
    ? item.items.some((message) => message.id === id)
    : item.message.id === id;
}

/**
 * One exchange: your message, the work it took, and the answer. A finished turn's work folds
 * into one line, so a thread reads as question and answer; nothing is dropped, only folded.
 * Indices are positions in the `segment()` list the turn was made from.
 */
export interface Turn {
  start: number;
  /** One past the last segment. */
  end: number;
  /** The reply that closes the turn: its last assistant message, with no step after it. */
  answer?: number;
  /** Notes and step groups between your message and the answer, folded when the turn is done. */
  work: number[];
  fold: boolean;
}
type AnySegment = ReturnType<typeof segment>[number];
function isAssistant(item: AnySegment): boolean {
  return item.type === 'message' && item.message.role === 'assistant';
}
function isUser(item: AnySegment): boolean {
  return item.type === 'message' && item.message.role === 'user';
}
/**
 * Splits segments into turns at each of your messages. `live` is whether the thread's last turn
 * is still going: that one never folds, so you watch it work. A turn folds only when it has an
 * answer and enough work to be worth folding: a note, or more than one group of steps.
 * Subagent cards and notices are never work, so they stay in view.
 */
export function turns(segments: AnySegment[], live: boolean): Turn[] {
  const starts = segments.flatMap((item, index) => (index === 0 || isUser(item) ? [index] : []));
  return starts.map((start, position) => {
    const end = starts[position + 1] ?? segments.length;
    let answer: number | undefined;
    for (let index = end - 1; index >= start; index -= 1) {
      const item = segments[index];
      if (item.type === 'activity' || isUser(item)) break;
      if (isAssistant(item)) {
        answer = index;
        break;
      }
    }
    const first = isUser(segments[start]) ? start + 1 : start;
    const work: number[] = [];
    for (let index = first; index < (answer ?? first); index += 1) {
      const item = segments[index];
      if (item.type === 'activity' || isAssistant(item)) work.push(index);
    }
    const notes = work.filter((index) => isAssistant(segments[index])).length;
    const groups = work.length - notes;
    const last = position === starts.length - 1;
    return {
      start,
      end,
      ...(answer !== undefined ? { answer } : {}),
      work,
      fold: !(last && live) && answer !== undefined && (notes > 0 || groups > 1),
    };
  });
}
/** An assistant message with steps after it in its turn: a progress note, not the answer. */
export function noteIndices(segments: AnySegment[]): Set<number> {
  const notes = new Set<number>();
  let stepsAfter = false;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const item = segments[index];
    if (isUser(item)) stepsAfter = false;
    else if (item.type === 'activity') stepsAfter = true;
    else if (isAssistant(item) && stepsAfter) notes.add(index);
  }
  return notes;
}
/** The messages a turn's folded work holds, for its one-line summary. */
export function workMessages(segments: AnySegment[], work: number[]): Message[] {
  return work.flatMap((index) => {
    const item = segments[index];
    return item.type === 'activity' ? item.items : item.type === 'message' ? [item.message] : [];
  });
}
/** How long the work took, from the CLI's own times; undefined when they weren't recorded. */
export function workDuration(messages: Message[], answer?: Message): number | undefined {
  const times = messages.map((message) => message.startedAt).filter((at) => at !== undefined);
  const from = times.length ? Math.min(...times) : undefined;
  const to = answer?.startedAt ?? Math.max(...messages.map((m) => m.endedAt ?? m.startedAt ?? 0));
  return from !== undefined && to > from ? to - from : undefined;
}
