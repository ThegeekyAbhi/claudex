import { readFile, stat } from 'node:fs/promises';
import { makeDiff, patchFromContent, stripPatchHeader } from '../core/diff';
import type { ChangesResult, FileDiff } from '../core/model';
import { resolveInside } from '../providers/shared/paths';
import { type ChangedFile, git, parseGitStatus } from './worktrees';

const MAX_FILES = 200;
const MAX_UNTRACKED_BYTES = 256 * 1024;

async function untracked(cwd: string, change: ChangedFile): Promise<FileDiff> {
  const target = await resolveInside(cwd, change.file);
  const info = await stat(target);
  if (info.size > MAX_UNTRACKED_BYTES)
    return { ...makeDiff(change.file, 'add', ''), truncated: true };
  const content = await readFile(target);
  if (content.includes(0)) return { ...makeDiff(change.file, 'add', ''), binary: true };
  return makeDiff(change.file, 'add', patchFromContent(content.toString('utf8'), '+'));
}
async function tracked(cwd: string, change: ChangedFile, base: string[]): Promise<FileDiff> {
  const raw = await git(cwd, [
    'diff',
    ...base,
    '--no-ext-diff',
    '--no-color',
    '--',
    ...(change.original ? [change.original] : []),
    change.file,
  ]);
  const kind: FileDiff['kind'] = /[RC]/.test(change.status)
    ? 'rename'
    : change.status.includes('D')
      ? 'delete'
      : change.status.includes('A')
        ? 'add'
        : 'update';
  const extra = change.original ? { original: change.original } : {};
  if (/^Binary files /m.test(raw) || raw.includes('GIT binary patch'))
    return { ...makeDiff(change.file, kind, ''), binary: true, ...extra };
  return makeDiff(change.file, kind, stripPatchHeader(raw), extra);
}
/** Reads the checkout's real state with Git, so this reports what is on disk, not what an agent said. */
export async function collectChanges(cwd: string): Promise<ChangesResult> {
  let raw: string;
  try {
    raw = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      files: [],
      error: /not a git repository/i.test(text)
        ? 'This folder is not a Git repository, so there is nothing to compare against.'
        : text,
    };
  }
  const changes = parseGitStatus(raw);
  const base = await git(cwd, ['rev-parse', '--verify', 'HEAD']).then(
    () => ['HEAD'],
    () => [],
  );
  const selected = changes.slice(0, MAX_FILES);
  const files: FileDiff[] = [];
  for (let index = 0; index < selected.length; index += 8) {
    files.push(
      ...(await Promise.all(
        selected
          .slice(index, index + 8)
          .map((change) =>
            change.status === '??' ? untracked(cwd, change) : tracked(cwd, change, base),
          ),
      )),
    );
  }
  return { files, ...(changes.length > MAX_FILES ? { truncated: true } : {}) };
}
