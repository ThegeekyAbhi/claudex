import type { FileDiff, Message, Session, ToolInfo } from '../../../shared/model';

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
export function verb(tool: ToolInfo): string {
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
    items.filter((m) => m.tool?.kind === kind && !m.tool.diffSource).length;
  const plural = (value: number, noun: string, many = `${noun}s`) =>
    `${value} ${value === 1 ? noun : many}`;
  const parts: string[] = [];
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
      : (message.tool?.diffs ?? []),
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
