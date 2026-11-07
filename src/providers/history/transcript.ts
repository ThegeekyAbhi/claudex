import type { AgentEvent, Message, Session } from '../../shared/model';
import { applyTranscript } from '../../shared/protocol/events';
import { ClaudeAgent } from '../claude/adapter';
import { CodexAgent } from '../codex/adapter';

/** A CLI's own transcript, rebuilt as rows of this thread. Nothing here is a guess. */
export interface NativeTranscript {
  /** Oldest first. Each has `nativeRef` and, where the CLI recorded one, `startedAt`. */
  messages: Message[];
  /** Records that couldn't be placed in time, so they were left out rather than guessed. */
  skipped: number;
}
/** What the CLI records as a user turn that you didn't write. */
const NOT_YOURS =
  /^(?:<(?:command-|local-command-|system-reminder|user-prompt-submit-hook|bash-(?:input|stdout|stderr))|\[Request interrupted)/;

/**
 * A copy of the thread to replay into. `open` are tool calls this thread still shows unfinished:
 * reading only the newest records, a call's result can arrive without the call itself.
 */
interface Replay {
  into: Session;
  index: Map<string, Message>;
  /** How many rows came from `open`, which are only there to receive results. */
  seeded: number;
}
function scratch(session: Session, open: Message[] = []): Replay {
  // Marked running, so a call whose result isn't among these records is left out.
  const seeded = open.flatMap((message) =>
    message.tool ? [{ ...message, tool: { ...message.tool, status: 'running' as const } }] : [],
  );
  return {
    into: { ...session, messages: seeded, status: 'idle' },
    index: new Map(seeded.map((message) => [message.id, message])),
    seeded: seeded.length,
  };
}
function sink({ into, index }: Replay) {
  return (event: AgentEvent) => {
    if (event.type === 'message' || event.type === 'patch') applyTranscript(into, event, index);
  };
}
/**
 * Gives every row added for one record a stable reference and that record's time. Row ids other
 * than tool calls are made from the reference too, so a second read yields the same ids.
 */
function stamp({ into, index }: Replay, from: number, ref: string, at: number): void {
  into.messages.slice(from).forEach((message, position) => {
    message.nativeRef = `${ref}:${position}`;
    message.startedAt = at;
    if (message.role !== 'tool') {
      index.delete(message.id);
      message.id = `native-${ref}-${position}`;
      index.set(message.id, message);
    }
  });
}
/** Thinking stays in the CLI; a call with no recorded outcome can't claim one. */
function finish({ into, seeded }: Replay, skipped: number): NativeTranscript {
  const messages = into.messages
    // A seeded call is returned only when its result arrived, so it can take that outcome.
    .filter((message, position) => position >= seeded || message.tool?.status !== 'running')
    .filter((message) => message.role !== 'thinking')
    .map((message) =>
      message.tool?.status === 'running'
        ? { ...message, tool: { ...message.tool, status: 'interrupted' as const } }
        : message,
    );
  return { messages, skipped };
}
function userText(content: unknown): string {
  const blocks: any[] =
    typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content)
        ? content
        : [];
  if (blocks.some((block) => block?.type === 'tool_result')) return '';
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n\n')
    .trim();
}

/**
 * Claude Code's records, oldest first: all of them as `getSessionMessages` returns them, or only
 * the newest, read from the end of the transcript. For those, pass the thread's unfinished calls.
 */
export function claudeTranscript(
  session: Session,
  records: unknown[],
  open: Message[] = [],
): NativeTranscript {
  const replay = scratch(session, open);
  const { into } = replay;
  const agent = new ClaudeAgent(into, 'claude', sink(replay));
  let skipped = 0;
  for (const raw of records as any[]) {
    // A subagent's own steps belong to its worker, not to this thread.
    // Nor do the summary that replaces compacted history, or records only the CLI's own view shows.
    if (!raw || raw.parent_tool_use_id || raw.isMeta || raw.is_meta) continue;
    if (raw.isCompactSummary || raw.isVisibleInTranscriptOnly) continue;
    if (raw.type !== 'user' && raw.type !== 'assistant') continue;
    const at = Date.parse(raw.timestamp);
    const ref = typeof raw.uuid === 'string' ? raw.uuid : undefined;
    if (Number.isNaN(at) || !ref) {
      skipped += 1;
      continue;
    }
    const from = into.messages.length;
    if (raw.type === 'user') {
      const text = userText(raw.message?.content);
      if (text && !NOT_YOURS.test(text)) into.messages.push({ id: ref, role: 'user', text });
      else agent.replayRecord(raw);
    } else agent.replayRecord(raw);
    stamp(replay, from, ref, at);
  }
  return finish(replay, skipped);
}

/** Codex's turns, as `thread/turns/list` returns them with full items, oldest first. */
export function codexTranscript(session: Session, turns: unknown[]): NativeTranscript {
  const replay = scratch(session);
  const { into } = replay;
  const agent = new CodexAgent(into, 'codex', sink(replay));
  let skipped = 0;
  for (const turn of turns as any[])
    for (const item of turn?.items ?? []) {
      const at =
        typeof item?.startedAtMs === 'number'
          ? item.startedAtMs
          : typeof turn.startedAt === 'number'
            ? turn.startedAt * 1000
            : undefined;
      const ref = typeof item?.id === 'string' ? item.id : undefined;
      if (at === undefined || !ref) {
        skipped += 1;
        continue;
      }
      // Images need the image store, and a plan is shown by the plan card, not as a row.
      if (['imageGeneration', 'imageView', 'plan', 'reasoning'].includes(item.type)) continue;
      const from = into.messages.length;
      if (item.type === 'userMessage') {
        const text = (item.content ?? [])
          .filter((part: any) => part?.type === 'text')
          .map((part: any) => String(part.text))
          .join('\n')
          .trim();
        if (text) into.messages.push({ id: ref, role: 'user', text });
      } else agent.replayItem(item);
      stamp(replay, from, ref, at);
    }
  return finish(replay, skipped);
}
