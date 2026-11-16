import {
  type FileDiff,
  isAgentPlanFile,
  type Message,
  type Session,
  type ToolInfo,
  type TurnOutcome,
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
 * Where the plan card goes: after a segment, at the end while it is still being written, or
 * nowhere in the transcript when its place is outside the loaded messages (the header shows it).
 */
export function planPlacement(
  segments: ReturnType<typeof segment>,
  plan: Session['plan'],
  messages: Message[],
): number | 'end' | 'hidden' {
  if (!plan) return 'hidden';
  if (plan.status === 'drafting' || !segments.length) {
    const index = segments.findIndex((item) => segmentHas(item, plan.after));
    return index === -1 ? 'end' : index;
  }
  if (plan.after) {
    const index = segments.findIndex((item) => segmentHas(item, plan.after));
    if (index !== -1) return index;
    if (messages.some((message) => message.id === plan.after)) return 'hidden';
  }
  // Older plans saved no place; the last message started before the plan was written is it.
  let found = -1;
  segments.forEach((item, index) => {
    const first = item.type === 'activity' ? item.items[0] : item.message;
    if (first.startedAt !== undefined && first.startedAt <= plan.updatedAt) found = index;
  });
  if (found !== -1) return found;
  // One still waiting on you stays in view; a built one never trails later turns.
  return plan.status === 'approved' ? 'hidden' : 'end';
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
  /** The first answer segment, where the work ends. */
  answer?: number;
  /** The turn's answer, in order; it can span several messages. Copied together, once. */
  answers: number[];
  /** Assistant messages that report progress between steps, not the answer. */
  notes: number[];
  /** Notes and step groups before the answer, folded when the turn is done. */
  work: number[];
  fold: boolean;
  /** How the turn ended, when the CLI said. */
  outcome?: TurnOutcome;
  /** Still running: nothing in it is final yet. */
  live: boolean;
}
type AnySegment = ReturnType<typeof segment>[number];
function isAssistant(item: AnySegment): boolean {
  return item.type === 'message' && item.message.role === 'assistant';
}
function isUser(item: AnySegment): boolean {
  return item.type === 'message' && item.message.role === 'user';
}
function phaseOf(item: AnySegment) {
  return item.type === 'message' ? item.message.phase : undefined;
}
const ANSWER_PHASES = new Set(['partial_answer', 'final_answer']);
/**
 * Splits segments into turns at each of your messages, and sorts each turn's assistant text into
 * notes and answer. The CLI's own phase decides first. Without one, only a finished turn's
 * trailing text, after its last step, reads as the answer; a stopped or failed turn's last words
 * are never promoted to one. `live` is whether the last turn is still going: it never folds, so
 * you watch it work. A turn folds only when it finished with an answer and enough work to be
 * worth folding: a note, or more than one group of steps. Subagent cards and notices are never
 * work, so they stay in view.
 */
export function turns(segments: AnySegment[], live: boolean): Turn[] {
  const starts = segments.flatMap((item, index) => (index === 0 || isUser(item) ? [index] : []));
  return starts.map((start, position) => {
    const end = starts[position + 1] ?? segments.length;
    const opener = segments[start];
    const outcome =
      opener.type === 'message' && opener.message.role === 'user'
        ? opener.message.outcome
        : undefined;
    const current = position === starts.length - 1 && live;
    const first = isUser(opener) ? start + 1 : start;
    const said = range(first, end).filter((index) => isAssistant(segments[index]));
    const labelled = said.some((index) => phaseOf(segments[index]));
    let answers: number[];
    if (labelled)
      answers = said.filter((index) => ANSWER_PHASES.has(phaseOf(segments[index]) ?? ''));
    else if (current || outcome === 'failed' || outcome === 'interrupted') answers = [];
    else {
      // Older threads and unlabelled text: the run of replies after the last step.
      answers = [];
      for (let index = end - 1; index >= first; index -= 1) {
        const item = segments[index];
        if (item.type === 'activity' || isUser(item)) break;
        if (isAssistant(item)) answers.unshift(index);
      }
    }
    const answerSet = new Set(answers);
    const lastAnswer = answers.at(-1);
    // While it runs, unlabelled text with no step after it yet may still be the answer.
    let pending: number | undefined;
    if (current && !labelled) {
      const tail = said.at(-1);
      if (tail !== undefined && !range(tail, end).some((i) => segments[i].type === 'activity'))
        pending = tail;
    }
    const notes = said.filter((index) => !answerSet.has(index) && index !== pending);
    const noteSet = new Set(notes);
    const work = range(first, lastAnswer ?? first).filter(
      (index) => segments[index].type === 'activity' || noteSet.has(index),
    );
    const groups = work.filter((index) => segments[index].type === 'activity').length;
    const folded = work.length - groups;
    return {
      start,
      end,
      ...(answers.length ? { answer: answers[0] } : {}),
      answers,
      notes,
      work,
      ...(outcome ? { outcome } : {}),
      live: current,
      fold:
        !current &&
        outcome !== 'failed' &&
        outcome !== 'interrupted' &&
        answers.length > 0 &&
        (folded > 0 || groups > 1),
    };
  });
}
const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
/**
 * How each assistant message shows: progress notes, and the one copy each finished answer gets,
 * under its last part, holding all of it.
 */
export function messageRoles(segments: AnySegment[], grouped: Turn[]) {
  const notes = new Set(grouped.flatMap((turn) => turn.notes));
  const copies = new Map(
    grouped.flatMap((turn) => {
      const last = turn.answers.at(-1);
      const text = answerText(segments, turn);
      return !turn.live && last !== undefined && text ? [[last, text] as const] : [];
    }),
  );
  return { notes, copies };
}
/** The text one copy of a turn's answer gives: every part of it, in order. */
export function answerText(segments: AnySegment[], turn: Turn): string {
  return turn.answers
    .map((index) => {
      const item = segments[index];
      return item.type === 'message' ? item.message.text.trim() : '';
    })
    .filter(Boolean)
    .join('\n\n');
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
