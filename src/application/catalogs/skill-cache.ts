import type { SkillCatalog } from '../../shared/model';

interface Entry {
  at: number;
  controller: AbortController;
  catalog: SkillCatalog;
  done: Promise<void>;
}

/** Context keys include the executable/profile identity and cwd, not just the agent name. */
export class SkillCache {
  private entries = new Map<string, Entry>();
  get(key: string): SkillCatalog {
    return this.entries.get(key)?.catalog ?? { status: 'idle', skills: [], problems: [] };
  }
  clear(): void {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }
  load(
    key: string,
    force: boolean,
    read: (signal: AbortSignal) => Promise<Pick<SkillCatalog, 'skills' | 'problems'>>,
    changed: () => void,
  ): Promise<void> {
    const previous = this.entries.get(key);
    if (previous && !force && Date.now() - previous.at < 30_000) return previous.done;
    previous?.controller.abort();
    if (this.entries.size >= 64 && !previous) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.get(oldest)?.controller.abort();
        this.entries.delete(oldest);
      }
    }
    const entry: Entry = {
      at: Date.now(),
      controller: new AbortController(),
      catalog: {
        ...(previous?.catalog ?? { skills: [], problems: [] }),
        status: 'loading',
        stale: !!previous,
      },
      done: Promise.resolve(),
    };
    this.entries.set(key, entry);
    entry.done = Promise.resolve()
      .then(() => read(entry.controller.signal))
      .then(
        (list) => {
          entry.catalog = { status: 'ready', ...list };
        },
        () => {
          entry.catalog = {
            ...entry.catalog,
            status: 'error',
            stale: true,
            error: 'Couldn’t refresh skills. Previous results may be out of date.',
          };
        },
      )
      .then(() => {
        if (this.entries.get(key) === entry && !entry.controller.signal.aborted) changed();
      });
    changed();
    return entry.done;
  }
}
