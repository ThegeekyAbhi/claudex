import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { git } from './git';

export async function createWorktree(cwd: string): Promise<string> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const name = `agent-${randomUUID().slice(0, 8)}`;
  const destination = path.join(path.dirname(root), `${path.basename(root)}-agent-worktrees`, name);
  await git(root, ['worktree', 'add', '-b', `agent-workspace/${name}`, destination, 'HEAD']);
  return destination;
}
export interface ChangedFile {
  file: string;
  original?: string;
  status: string;
}
export function parseGitStatus(raw: string): ChangedFile[] {
  const records = raw.split('\0');
  const changes: ChangedFile[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const file = record.slice(3);
    const original = /[RC]/.test(status) ? records[++index] : undefined;
    changes.push({ file, status, original });
  }
  return changes;
}
