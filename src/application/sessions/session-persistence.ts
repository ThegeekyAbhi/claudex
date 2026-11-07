import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { persistableSession, restoreSessions, type Session } from '../../shared/model';

interface Dependencies {
  sessions: Session[];
  storage: string;
}
interface SaveSchedule {
  delayMs: number;
  flush(): Promise<void>;
  onError(error: unknown): void;
}

export class SessionPersistence {
  private saveQueue: Promise<void> = Promise.resolve();
  private lastSaved?: string;
  private saveTimer?: NodeJS.Timeout;
  constructor(private deps: Dependencies) {}
  scheduleSave(schedule: SaveSchedule): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      void schedule.flush().catch(schedule.onError);
    }, schedule.delayMs);
  }
  async load(): Promise<void> {
    try {
      this.deps.sessions.push(
        ...restoreSessions(
          JSON.parse(await readFile(path.join(this.deps.storage, 'sessions.json'), 'utf8')),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `Could not restore sessions; stored files were preserved. ${String(error)}`,
        );
    }
    this.lastSaved = this.serialize();
  }
  serialize(): string {
    return JSON.stringify({
      version: 1,
      sessions: this.deps.sessions.map(({ approval, transition, ...session }) =>
        persistableSession(session),
      ),
    });
  }
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const data = this.serialize();
    // Windows with no folder share a store, so an idle one must not overwrite with its old copy.
    if (data === this.lastSaved) return this.saveQueue;
    const write = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.deps.storage, { recursive: true });
        const temporary = path.join(this.deps.storage, 'sessions.json.tmp');
        await writeFile(temporary, data, { mode: 0o600 });
        await rename(temporary, path.join(this.deps.storage, 'sessions.json'));
        this.lastSaved = data;
      });
    this.saveQueue = write;
    return write;
  }
}
