import { open, stat } from 'node:fs/promises';

/** Where the last read of a transcript stopped. Kept in memory only. */
export interface TailMark {
  file: string;
  /** The file's identity, so a replaced file is never read from an old position. */
  ino: number;
  /** Bytes already read, always at the end of a whole line once `aligned`. */
  offset: number;
  /**
   * False right after a full read: the position was taken while the CLI may have been mid-line,
   * so a partial first line is expected once and dropped. That line was in the full read.
   */
  aligned: boolean;
}

/** Larger than this, appended text is read in full through the CLI's own reader instead. */
const MAX_APPENDED = 32 * 1024 * 1024;

/** Where a full read starts the tail from: the file as it stood just before that read. */
export async function markBefore(file: string): Promise<TailMark | undefined> {
  try {
    const info = await stat(file);
    return { file, ino: info.ino, offset: info.size, aligned: false };
  } catch {
    return undefined;
  }
}

/**
 * The records Claude Code appended to a session's transcript since `mark`, shaped as
 * `getSessionMessages` returns them, and where this read stopped. Returns undefined whenever the
 * newest lines can't be trusted on their own (the file shrank, was replaced, or has a line that
 * doesn't parse); the caller then reads the whole session through the SDK. Only whole lines are
 * read; a line still being written is left for next time.
 */
export async function readAppended(
  mark: TailMark,
): Promise<{ records: unknown[]; mark: TailMark } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(mark.file, 'r');
    const info = await handle.stat();
    if (info.ino !== mark.ino || info.size < mark.offset) return undefined;
    const length = info.size - mark.offset;
    if (length > MAX_APPENDED) return undefined;
    if (!length) return { records: [], mark };
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, mark.offset);
    // Found in bytes, not in decoded text: a character the decoder can't read would otherwise
    // shift every later position.
    const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (end < 0) return { records: [], mark };
    const lines = buffer.subarray(0, end).toString('utf8').split('\n');
    const records: unknown[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      // JSON.parse ignores a trailing \r, so lines written with Windows endings read the same.
      let raw: any;
      try {
        raw = JSON.parse(line);
      } catch {
        if (index === 0 && !mark.aligned) continue;
        return undefined;
      }
      const record = asRecord(raw);
      if (record) records.push(record);
    }
    return {
      records,
      mark: {
        ...mark,
        offset: mark.offset + end + 1,
        aligned: true,
      },
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** A transcript line as `getSessionMessages` gives it: only your session's own turns. */
function asRecord(raw: any): unknown {
  if (!raw || (raw.type !== 'user' && raw.type !== 'assistant')) return undefined;
  // A subagent's steps are its own; the SDK leaves them out of the session too.
  if (raw.isSidechain) return undefined;
  return {
    type: raw.type,
    uuid: raw.uuid,
    timestamp: raw.timestamp,
    isMeta: raw.isMeta,
    isCompactSummary: raw.isCompactSummary,
    isVisibleInTranscriptOnly: raw.isVisibleInTranscriptOnly,
    parent_tool_use_id: null,
    message: { id: raw.message?.id, model: raw.message?.model, content: raw.message?.content },
  };
}
