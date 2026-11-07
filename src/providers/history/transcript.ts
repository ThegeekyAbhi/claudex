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
/** Markup the CLI records as a user turn that you didn't write. */
const NOT_YOURS =
  /^<(?:command-|local-command-|system-reminder|user-prompt-submit-hook|bash-(?:input|stdout|stderr))/;

function scratch(session: Session): Session {
  return { ...session, messages: [], status: 'idle' };
}
function sink(into: Session) {
  return (event: AgentEvent) => {
    if (event.type === 'message' || event.type === 'patch') applyTranscript(into, event);
  };
}
/**
 * Gives every row added for one record a stable reference and that record's time. Row ids other
 * than tool calls are made from the reference too, so a second read yields the same ids.
 */
function stamp(into: Session, from: number, ref: string, at: number): void {
  into.messages.slice(from).forEach((message, index) => {
    message.nativeRef = `${ref}:${index}`;
    message.startedAt = at;
    if (message.role !== 'tool') message.id = `native-${ref}-${index}`;
  });
}
/** Thinking stays in the CLI; a call with no recorded outcome can't claim one. */
function finish(into: Session, skipped: number): NativeTranscript {
  const messages = into.messages
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

/** Claude Code's records, as `getSessionMessages` returns them, oldest first. */
export function claudeTranscript(session: Session, records: unknown[]): NativeTranscript {
  const into = scratch(session);
  const agent = new ClaudeAgent(into, 'claude', sink(into));
  let skipped = 0;
  for (const raw of records as any[]) {
    // A subagent's own steps belong to its worker, not to this thread.
    if (!raw || raw.parent_tool_use_id || raw.isMeta) continue;
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
    stamp(into, from, ref, at);
  }
  return finish(into, skipped);
}

/** Codex's turns, as `thread/turns/list` returns them with full items, oldest first. */
export function codexTranscript(session: Session, turns: unknown[]): NativeTranscript {
  const into = scratch(session);
  const agent = new CodexAgent(into, 'codex', sink(into));
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
      stamp(into, from, ref, at);
    }
  return finish(into, skipped);
}
