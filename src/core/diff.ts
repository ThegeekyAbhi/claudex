import type { FileDiff } from './model';

const MAX_PATCH_BYTES = 256 * 1024;
const UNNUMBERED_HUNK = '@@ edit @@';

export function countPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}
export function makeDiff(
  path: string,
  kind: FileDiff['kind'],
  patch: string,
  extra: Partial<FileDiff> = {},
): FileDiff {
  const truncated = patch.length > MAX_PATCH_BYTES;
  const body = truncated ? patch.slice(0, MAX_PATCH_BYTES) : patch;
  return {
    path,
    kind,
    patch: body,
    ...countPatch(body),
    ...(truncated ? { truncated } : {}),
    ...extra,
  };
}
/** A compact patch for a string replacement, trimming the lines both sides share. */
export function patchFromEdit(before: string, after: string): string {
  const oldLines = before ? before.split('\n') : [];
  const newLines = after ? after.split('\n') : [];
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const context = Math.max(0, start - 2);
  const trailing = Math.min(oldLines.length, oldEnd + 2);
  return [
    // A string replacement carries no file position, so this hunk has no line numbers to claim.
    UNNUMBERED_HUNK,
    ...oldLines.slice(context, start).map((line) => ` ${line}`),
    ...oldLines.slice(start, oldEnd).map((line) => `-${line}`),
    ...newLines.slice(start, newEnd).map((line) => `+${line}`),
    ...oldLines.slice(oldEnd, trailing).map((line) => ` ${line}`),
  ].join('\n');
}
export function patchFromContent(content: string, sign: '+' | '-'): string {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  const range = sign === '+' ? `-0,0 +1,${lines.length}` : `-1,${lines.length} +0,0`;
  return [`@@ ${range} @@`, ...lines.map((line) => `${sign}${line}`)].join('\n');
}
/** Drops git's `diff --git`/`index` preamble, keeping the hunks. */
export function stripPatchHeader(raw: string): string {
  const start = raw.startsWith('@@') ? 0 : raw.indexOf('\n@@');
  if (start < 0) return raw.trimEnd();
  return (start === 0 ? raw : raw.slice(start + 1)).trimEnd();
}
export interface StructuredHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}
export function patchFromHunks(hunks: StructuredHunk[]): string {
  return hunks
    .map(
      (hunk) =>
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`,
    )
    .join('\n');
}
export type DiffLine =
  | { kind: 'hunk'; text: string }
  | { kind: 'add' | 'del' | 'context'; text: string; oldLine?: number; newLine?: number };
export function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine: number | undefined;
  let newLine: number | undefined;
  for (const raw of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (raw === UNNUMBERED_HUNK) {
      oldLine = undefined;
      newLine = undefined;
      continue;
    }
    if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), newLine });
      if (newLine !== undefined) newLine++;
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1), oldLine });
      if (oldLine !== undefined) oldLine++;
    } else if (raw.startsWith('\\')) lines.push({ kind: 'context', text: raw });
    else if (raw.startsWith(' ') || (raw === '' && lines.length)) {
      lines.push({
        kind: 'context',
        text: raw.slice(1),
        oldLine,
        newLine,
      });
      if (oldLine !== undefined) oldLine++;
      if (newLine !== undefined) newLine++;
    }
  }
  return lines;
}
