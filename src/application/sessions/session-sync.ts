import { randomUUID } from 'node:crypto';
import type { Message, Session } from '../../shared/model';

/** The CLI's transcript as rows, oldest first; see `src/providers/history/transcript.ts`. */
export interface NativeRows {
  messages: Message[];
  skipped: number;
}
export interface SyncOutcome {
  added: number;
  tools: number;
  /** Rows already here whose outcome the CLI has since recorded. */
  updated: number;
  skipped: number;
}

/**
 * Where to read from. A thread saved by a Claudex without this field has no record of what it last
 * matched; its last change is the safe stand-in, so nothing it already shows is added twice. A
 * thread opened from the terminal starts with the CLI's whole history.
 */
export function syncCursor(session: Session): number {
  if (session.nativeSyncedAt !== undefined) return session.nativeSyncedAt;
  if (session.origin === 'terminal') return 0;
  return session.messages.length ? session.updatedAt : 0;
}

/**
 * Adds what the CLI recorded that this thread doesn't show yet: newer than the cursor, and not
 * already here by reference. A tool call shown as unfinished takes the outcome the CLI recorded.
 * Nothing is inferred: rows come only from the CLI's own records.
 */
export function mergeNative(
  session: Session,
  rows: NativeRows,
  options: { announce: boolean },
): SyncOutcome {
  const cursor = syncCursor(session);
  const refs = new Set(session.messages.map((message) => message.nativeRef).filter(Boolean));
  const byId = new Map(session.messages.map((message) => [message.id, message]));
  const fresh: Message[] = [];
  let updated = 0;
  let latest = cursor;
  for (const row of rows.messages) {
    latest = Math.max(latest, row.startedAt ?? 0);
    const existing = byId.get(row.id);
    if (existing?.tool && row.tool) {
      const open = existing.tool.status === 'running' || existing.tool.status === 'interrupted';
      if (open && row.tool.status !== 'interrupted' && row.tool.status !== 'running') {
        existing.tool = { ...existing.tool, status: row.tool.status };
        existing.text = row.text || existing.text;
        updated += 1;
      }
      continue;
    }
    if (existing || (row.nativeRef && refs.has(row.nativeRef))) continue;
    // Equal times are kept: a record already here is matched by its reference above.
    if ((row.startedAt ?? 0) < cursor) continue;
    fresh.push(row);
  }
  const tools = fresh.filter((message) => message.role === 'tool').length;
  const said = fresh.length - tools;
  if (fresh.length && options.announce) {
    const counts = [
      `${said} message${said === 1 ? '' : 's'}`,
      ...(tools ? [`${tools} tool call${tools === 1 ? '' : 's'}`] : []),
    ].join(', ');
    session.messages.push({
      id: randomUUID(),
      role: 'notice',
      text: `From the terminal: ${counts}.`,
    });
  }
  session.messages.push(...fresh);
  // Said once: the same old entries stay unreadable on every later read.
  const skippedId = `${session.id}-native-skipped`;
  if (rows.skipped && !session.messages.some((message) => message.id === skippedId))
    session.messages.push({
      id: skippedId,
      role: 'notice',
      text: `${rows.skipped} entr${rows.skipped === 1 ? 'y' : 'ies'} in the CLI’s history had no time recorded, so ${rows.skipped === 1 ? 'it isn’t' : 'they aren’t'} shown here. The CLI still has ${rows.skipped === 1 ? 'it' : 'them'}.`,
    });
  // The newest record read, not the clock: anything the CLI writes after this read is still new.
  session.nativeSyncedAt = latest;
  if (fresh.length || updated) session.updatedAt = Math.max(session.updatedAt, latest);
  return { added: fresh.length, tools, updated, skipped: rows.skipped };
}
