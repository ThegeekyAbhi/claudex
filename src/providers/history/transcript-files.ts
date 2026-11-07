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

const LOOK_AGAIN_MS = 10_000;

/**
 * When the CLI last wrote this session's transcript, read from the file's own time, or undefined
 * when the file can't be found. Reading the time is cheap; reading the history starts a process.
 */
export class TranscriptClock {
  private paths = new Map<string, string>();
  /**
   * When each missing transcript was last looked for. Looking walks folders, so a thread whose
   * file doesn't exist yet is looked for again only after a while.
   */
  private missing = new Map<string, number>();
  private key(provider: Provider, id: string, env?: Record<string, string>): string {
    return `${provider}:${env?.CLAUDE_CONFIG_DIR ?? env?.CODEX_HOME ?? ''}:${id}`;
  }
  /** The transcript's path, found once and then remembered. */
  async file(
    provider: Provider,
    id: string,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<string | undefined> {
    const key = this.key(provider, id, env);
    const known = this.paths.get(key);
    if (known) return known;
    if (Date.now() - (this.missing.get(key) ?? 0) < LOOK_AGAIN_MS) return undefined;
    const found =
      provider === 'codex'
        ? await findCodexRollout(id, env)
        : await findClaudeTranscript(id, cwd, env);
    if (found) {
      this.paths.set(key, found);
      this.missing.delete(key);
    } else this.missing.set(key, Date.now());
    return found;
  }
  async modifiedAt(
    provider: Provider,
    id: string,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<number | undefined> {
    const key = this.key(provider, id, env);
    const file = await this.file(provider, id, cwd, env);
    if (!file) return undefined;
    try {
      return (await stat(file)).mtimeMs;
    } catch {
      // Moved or removed since it was found: look again next time.
      this.paths.delete(key);
      return undefined;
    }
  }
}
