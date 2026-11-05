import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { makeDiff, patchFromContent, patchFromEdit } from '../core/diff';
import type { FileDiff } from '../core/model';
import { git } from '../host/worktrees';
import { resolveInside } from '../providers/shared/paths';

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
interface Entry {
  fingerprint: string;
  text?: string;
  binary?: boolean;
}
interface Snapshot {
  files: Map<string, Entry>;
  /** Includes skipped paths, so skipping a file can never look like a deletion. */
  paths: Set<string>;
  note?: string;
}
export interface ObservedChanges {
  diffs: FileDiff[];
  note?: string;
}

async function snapshot(cwd: string): Promise<Snapshot> {
  const names = await git(cwd, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    '.',
  ]);
  const paths = new Set(names.split('\0').filter(Boolean));
  const files = new Map<string, Entry>();
  let total = 0;
  let skipped = Math.max(0, paths.size - MAX_FILES);
  for (const file of [...paths].sort().slice(0, MAX_FILES)) {
    try {
      const lexical = path.resolve(cwd, file);
      const info = await lstat(lexical);
      if (!info.isFile() || info.isSymbolicLink()) {
        skipped++;
        continue;
      }
      const target = await resolveInside(cwd, file);
      // Also exclude paths reached through a symlinked directory inside the checkout.
      if (target !== lexical) {
        skipped++;
        continue;
      }
      const fingerprint = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      if (info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) {
        files.set(file, { fingerprint });
        skipped++;
        continue;
      }
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: Buffer;
      try {
        // A bounded read also handles files that grow after stat.
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        content = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      total += content.length;
      if (content.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
        files.set(file, { fingerprint });
        skipped++;
        continue;
      }
      const hash = createHash('sha256').update(content).digest('hex');
      const binary = content.includes(0);
      files.set(file, {
        fingerprint: hash,
        ...(binary ? { binary } : { text: content.toString('utf8') }),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') paths.delete(file);
      else skipped++;
    }
  }
  return {
    files,
    paths,
    ...(skipped
      ? {
          note: `${skipped} ${skipped === 1 ? 'path' : 'paths'} skipped (capture limits, symlinks, or unreadable files).`,
        }
      : {}),
  };
}

function changedLines(patch: string): string {
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .join('\n');
}

/** Read-only, per-turn checkpoints; these describe observed changes, never command authorship. */
export class FileObserver {
  private queue: Promise<void> = Promise.resolve();
  private constructor(
    private cwd: string,
    private baseline?: Snapshot,
  ) {}

  static async start(cwd: string): Promise<FileObserver> {
    try {
      const root = await realpath(cwd);
      return new FileObserver(root, await snapshot(root));
    } catch {
      return new FileObserver(cwd);
    }
  }

  checkpoint(report: (result: ObservedChanges) => void, native: FileDiff[] = []): void {
    this.queue = this.queue.then(async () => {
      if (!this.baseline) {
        report({
          diffs: [],
          note: 'Shell-change capture unavailable: could not read a Git checkout.',
        });
        return;
      }
      try {
        const next = await snapshot(this.cwd);
        const diffs: FileDiff[] = [];
        for (const file of new Set([...this.baseline.paths, ...next.paths])) {
          const before = this.baseline.files.get(file);
          const after = next.files.get(file);
          if (before?.fingerprint === after?.fingerprint) continue;
          // Missing content from a skipped path is unknown, not a new or deleted file.
          if ((!before && this.baseline.paths.has(file)) || (!after && next.paths.has(file)))
            continue;
          const kind = !before ? 'add' : !after ? 'delete' : 'update';
          if (before?.binary || after?.binary) {
            diffs.push(makeDiff(file, kind, '', { binary: true }));
          } else if ((before && before.text === undefined) || (after && after.text === undefined)) {
            diffs.push(makeDiff(file, kind, '', { truncated: true }));
          } else {
            let patch: string;
            if (!before) patch = patchFromContent(after?.text ?? '', '+');
            else if (!after) patch = patchFromContent(before.text ?? '', '-');
            else patch = patchFromEdit(before.text ?? '', after.text ?? '');
            diffs.push(makeDiff(file, kind, patch));
          }
        }
        const note = [this.baseline.note, next.note].filter(Boolean);
        this.baseline = next;
        const observed = diffs.filter(
          (diff) =>
            !native.some(
              (item) =>
                path.relative(this.cwd, path.resolve(this.cwd, item.path)) === diff.path &&
                changedLines(item.patch) === changedLines(diff.patch) &&
                item.binary === diff.binary &&
                item.truncated === diff.truncated,
            ),
        );
        report({ diffs: observed, ...(note.length ? { note: [...new Set(note)].join(' ') } : {}) });
      } catch {
        // Do not compare against a stale checkpoint after losing access to the checkout.
        this.baseline = undefined;
        report({
          diffs: [],
          note: 'Shell-change capture unavailable: could not read the checkout.',
        });
      }
    });
  }

  release(): void {
    this.queue = this.queue.then(() => {
      this.baseline = undefined;
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}
