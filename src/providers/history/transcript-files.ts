import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Provider } from '../../shared/model';
import { findClaudeTranscript } from '../claude/title';

/** Codex keeps each thread in `sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`. */
export async function findCodexRollout(
  id: string,
  env?: Record<string, string>,
): Promise<string | undefined> {
  const root = path.join(
    env?.CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex'),
    'sessions',
  );
  const suffix = `-${id}.jsonl`;
  // Newest folders first: a thread being continued is usually recent.
  const names = async (dir: string) =>
    (await readdir(dir).catch(() => [] as string[])).sort().reverse();
  for (const year of await names(root))
    for (const month of await names(path.join(root, year)))
      for (const day of await names(path.join(root, year, month))) {
        const dir = path.join(root, year, month, day);
        const found = (await names(dir)).find((name) => name.endsWith(suffix));
        if (found) return path.join(dir, found);
      }
  return undefined;
}

/**
 * When the CLI last wrote this session's transcript, read from the file's own time, or undefined
 * when the file can't be found. Reading the time is cheap; reading the history starts a process.
 */
export class TranscriptClock {
  private paths = new Map<string, string>();
  async modifiedAt(
    provider: Provider,
    id: string,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<number | undefined> {
    const key = `${provider}:${env?.CLAUDE_CONFIG_DIR ?? env?.CODEX_HOME ?? ''}:${id}`;
    let file = this.paths.get(key);
    if (!file) {
      file =
        provider === 'codex'
          ? await findCodexRollout(id, env)
          : await findClaudeTranscript(id, cwd, env);
      if (!file) return undefined;
      this.paths.set(key, file);
    }
    try {
      return (await stat(file)).mtimeMs;
    } catch {
      // Moved or removed since it was found: look again next time.
      this.paths.delete(key);
      return undefined;
    }
  }
}
