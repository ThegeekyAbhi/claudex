import {
  constants,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { persistableSession, restoreSessions, type Session } from '../../shared/model';

interface Dependencies {
  sessions: Session[];
  storage: string;
}
const BACKUPS_KEPT = 5;
const BACKUP = /^sessions\.backup-\d{8}\.json$/;
interface SaveSchedule {
  delayMs: number;
  flush(): Promise<void>;
  onError(error: unknown): void;
}

export class SessionPersistence {
  private saveQueue: Promise<void> = Promise.resolve();
  private lastSaved?: string;
  private saveTimer?: NodeJS.Timeout;
  private backedUp = false;
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
  /**
   * Before the first write after loading, keep a copy of the saved threads as they were, once a
   * day. A newer or older Claudex can then always go back to what it last read.
   */
  async backup(now = new Date()): Promise<void> {
    if (this.backedUp) return;
    this.backedUp = true;
    const day = now.toISOString().slice(0, 10).replaceAll('-', '');
    try {
      await copyFile(
        path.join(this.deps.storage, 'sessions.json'),
        path.join(this.deps.storage, `sessions.backup-${day}.json`),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Nothing saved yet, or today's copy is already there.
      if (code !== 'ENOENT' && code !== 'EEXIST') throw error;
    }
    const old = (await readdir(this.deps.storage)).filter((name) => BACKUP.test(name)).sort();
    for (const name of old.slice(0, -BACKUPS_KEPT))
      await rm(path.join(this.deps.storage, name), { force: true });
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
        await this.backup();
        const temporary = path.join(this.deps.storage, 'sessions.json.tmp');
        await writeFile(temporary, data, { mode: 0o600 });
        await rename(temporary, path.join(this.deps.storage, 'sessions.json'));
        this.lastSaved = data;
      });
    this.saveQueue = write;
    return write;
  }
}
