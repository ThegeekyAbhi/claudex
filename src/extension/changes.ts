import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { git } from '../infrastructure/git';
import { type ChangedFile, parseGitStatus } from '../infrastructure/worktrees';
import { resolveInside } from '../providers/shared/paths';
import type { ChangesResult, FileDiff } from '../shared/model';

const MAX_UNTRACKED_BYTES = 256 * 1024;
type Count = { additions: number; deletions: number; binary: boolean };

/** Line count for a file Git has no baseline for. Large or unreadable files report `truncated`. */
async function countUntracked(cwd: string, change: ChangedFile): Promise<Count | undefined> {
  const target = await resolveInside(cwd, change.file);
  if ((await stat(target)).size > MAX_UNTRACKED_BYTES) return undefined;
  const content = await readFile(target);
  if (content.includes(0)) return { additions: 0, deletions: 0, binary: true };
  const text = content.toString('utf8');
  const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  return { additions: lines, deletions: 0, binary: false };
}
/** `git diff --numstat -z`: renames carry an empty path field followed by old and new paths. */
function parseNumstat(raw: string): Map<string, Count> {
  const counts = new Map<string, Count>();
  const parts = raw.split('\0');
  for (let index = 0; index < parts.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[index]);
    if (!match) continue;
    let file = match[3];
    if (!file) {
      index += 2;
      file = parts[index];
    }
    counts.set(file, {
      additions: Number(match[1]) || 0,
      deletions: Number(match[2]) || 0,
      binary: match[1] === '-',
    });
  }
  return counts;
}
function kindOf(change: ChangedFile): FileDiff['kind'] {
  if (change.original) return 'rename';
  if (change.status.includes('D')) return 'delete';
  if (change.status === '??' || change.status.includes('A')) return 'add';
  return 'update';
}
/**
 * Reads the checkout's real state with Git, so this reports what is on disk, not what an agent
 * said. Metadata only: VS Code's own diff editors render the content.
 */
export async function collectChanges(cwd: string): Promise<ChangesResult> {
  let status: ChangedFile[];
  try {
    cwd = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    status = parseGitStatus(
      await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      files: [],
      error: /not a git repository/i.test(text)
        ? 'This folder is not a Git repository, so there is nothing to compare against.'
        : text,
    };
  }
  const baseline = await git(cwd, ['rev-parse', '--verify', 'HEAD']).then(
    (value) => value.trim(),
    () => undefined,
  );
  const counts = baseline
    ? parseNumstat(
        await git(cwd, [
          'diff',
          '--numstat',
          '-z',
          '--no-ext-diff',
          '--no-textconv',
          baseline,
          '--',
        ]),
      )
    : new Map<string, Count>();
  const files: FileDiff[] = [];
  for (const change of status) {
    let count = counts.get(change.file);
    let truncated = false;
    if (change.status === '??' || !baseline) {
      count = await countUntracked(cwd, change).catch(() => undefined);
      truncated = !count;
    }
    files.push({
      path: change.file,
      kind: kindOf(change),
      patch: '',
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
      ...(count?.binary ? { binary: true } : {}),
      ...(truncated ? { truncated } : {}),
      ...(change.original ? { original: change.original } : {}),
    });
  }
  return { root: cwd, baseline, files };
}

/**
 * A file's content at a commit, located from its absolute path alone so a restored editor can
 * reload it after a window reload. Read-only; the revision must be a full object ID.
 */
export async function readAtRevision(file: string, revision: string): Promise<string> {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(revision)) throw new Error('Invalid revision.');
  // Deleted files: find the nearest folder that still exists, then come back down.
  let folder = path.dirname(file);
  while (!existsSync(folder) && path.dirname(folder) !== folder) folder = path.dirname(folder);
  const real = await realpath(folder);
  const root = (await git(real, ['rev-parse', '--show-toplevel'])).trim();
  const relative = path.relative(root, path.join(real, path.relative(folder, file)));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Path outside the checkout.');
  return git(root, ['show', `${revision}:${relative.split(path.sep).join('/')}`]);
}
