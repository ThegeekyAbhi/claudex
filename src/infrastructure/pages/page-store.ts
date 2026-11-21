import { randomBytes } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { dailyId, dailyTemplate } from '../../shared/domain/pages/daily';
import { PAGE_ID, type PageEntry, pageEntry } from '../../shared/domain/pages/entry';
import { type PageMeta, splitFrontMatter, withPageMeta } from '../../shared/domain/pages/meta';
import { newPageTemplate, pageSlug, pageTitle } from '../../shared/domain/pages/title';
import { ASSETS, AssetStore } from './asset-store';
import { atomicWrite, markdownIds } from './files';
import { PageNotFound } from './page-not-found';

export { PageNotFound };

export function newPageSuffix(): string {
  return randomBytes(3).toString('hex');
}
/** Today in this machine's time zone, as `YYYY-MM-DD`. */
export function localDay(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const TRASH = '.trash';

/**
 * Your pages for one workspace: ordinary Markdown files in the extension's storage.
 *
 * Writes go through a temporary file and a rename, so a reader never sees half a page. The
 * page editor itself edits open pages through VS Code's document, not through here.
 */
export class PageStore {
  private watcher?: FSWatcher;
  private cache = new Map<string, { mtime: number; entry: PageEntry }>();
  /** The images in these pages. */
  readonly assets: AssetStore;
  constructor(
    readonly folder: string,
    private suffix: () => string = newPageSuffix,
  ) {
    this.assets = new AssetStore(path.join(folder, ASSETS));
  }

  file(id: string): string {
    if (!PAGE_ID.test(id)) throw new PageNotFound(id);
    return path.join(this.folder, `${id}.md`);
  }
  /** The page id for a file in this store, or undefined for any other file. */
  idOf(file: string): string | undefined {
    const relative = path.relative(this.folder, file).split(path.sep).join('/');
    const id = relative.replace(/\.md$/, '');
    return relative.endsWith('.md') && PAGE_ID.test(id) ? id : undefined;
  }
  private trashFile(id: string): string {
    return path.join(this.folder, TRASH, `${id.replace('/', '__')}.md`);
  }

  async exists(id: string): Promise<boolean> {
    try {
      await stat(this.file(id));
      return true;
    } catch {
      return false;
    }
  }
  async read(id: string): Promise<string> {
    try {
      return await readFile(this.file(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new PageNotFound(id);
      throw error;
    }
  }
  async write(id: string, text: string): Promise<void> {
    await atomicWrite(this.file(id), text);
  }

  /** Every page, newest change first. */
  async list(): Promise<PageEntry[]> {
    const ids = [
      ...(await markdownIds(this.folder)),
      ...(await markdownIds(path.join(this.folder, 'daily'))).map((name) => `daily/${name}`),
    ].filter((id) => PAGE_ID.test(id));
    const entries = await Promise.all(ids.map((id) => this.entry(id)));
    const pages = entries.filter((entry): entry is PageEntry => Boolean(entry));
    return pages.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async entry(id: string): Promise<PageEntry | undefined> {
    try {
      const info = await stat(this.file(id));
      const cached = this.cache.get(id);
      if (cached?.mtime === info.mtimeMs) return cached.entry;
      const entry = pageEntry(id, await readFile(this.file(id), 'utf8'), info.mtimeMs);
      this.cache.set(id, { mtime: info.mtimeMs, entry });
      return entry;
    } catch {
      this.cache.delete(id);
      return undefined;
    }
  }

  /** A new page, named after its title. */
  async create(title = '', body?: string, meta: PageMeta = {}): Promise<string> {
    const id = `${pageSlug(title || 'untitled')}-${this.suffix()}`;
    let text =
      body === undefined ? newPageTemplate(title) : `# ${title.trim()}\n\n${body.trim()}\n`;
    if (meta.by || meta.icon) text = withPageMeta(text, meta);
    await atomicWrite(this.file(id), text);
    return id;
  }
  /** The day's page, created from the daily template the first time. */
  async daily(day: string): Promise<string> {
    const id = dailyId(day);
    if (!(await this.exists(id))) await atomicWrite(this.file(id), dailyTemplate(day), 'wx');
    return id;
  }
  /** The latest daily page before `day`, if there is one. */
  async previousDaily(day: string): Promise<string | undefined> {
    const days = (await markdownIds(path.join(this.folder, 'daily')))
      .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < day)
      .sort();
    const last = days.at(-1);
    return last ? dailyId(last) : undefined;
  }
  async duplicate(id: string): Promise<string> {
    const text = await this.read(id);
    const { body } = splitFrontMatter(text);
    const title = `${pageTitle(body)} (copy)`;
    const copy = `${pageSlug(title)}-${this.suffix()}`;
    await atomicWrite(this.file(copy), text.replace(body, body.replace(/^#\s+.*$/m, `# ${title}`)));
    return copy;
  }

  /** Moves a page to the trash, from where it can be restored. */
  async trash(id: string): Promise<void> {
    const target = this.trashFile(id);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(this.file(id), target);
    this.cache.delete(id);
  }
  async trashed(): Promise<PageEntry[]> {
    const names = await markdownIds(path.join(this.folder, TRASH));
    const entries = await Promise.all(
      names.map(async (name) => {
        const id = name.replace('__', '/');
        if (!PAGE_ID.test(id)) return undefined;
        try {
          const file = path.join(this.folder, TRASH, `${name}.md`);
          const info = await stat(file);
          return pageEntry(id, await readFile(file, 'utf8'), info.mtimeMs);
        } catch {
          return undefined;
        }
      }),
    );
    return entries
      .filter((entry): entry is PageEntry => Boolean(entry))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async restore(id: string): Promise<string> {
    // A page made with the same id since keeps its place; the restored one gets a new id.
    const target = (await this.exists(id))
      ? `${pageSlug(id.replace(/^daily\//, 'daily-'))}-${this.suffix()}`
      : id;
    await mkdir(path.dirname(this.file(target)), { recursive: true });
    await rename(this.trashFile(id), this.file(target));
    return target;
  }
  async deleteForever(id: string): Promise<void> {
    await rm(this.trashFile(id), { force: true });
  }

  /** Pages whose title or text contains every word of the query, with where it matched. */
  async search(query: string): Promise<{ entry: PageEntry; excerpt?: string }[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const results: { entry: PageEntry; excerpt?: string; score: number }[] = [];
    for (const entry of await this.list()) {
      const text = splitFrontMatter(await this.read(entry.id).catch(() => '')).body;
      const lower = text.toLowerCase();
      const title = entry.title.toLowerCase();
      if (!words.every((word) => lower.includes(word) || title.includes(word))) continue;
      const titleHits = words.filter((word) => title.includes(word)).length;
      const at = lower.indexOf(words[0]);
      const line = at >= 0 ? text.slice(text.lastIndexOf('\n', at) + 1).split('\n')[0] : '';
      results.push({
        entry,
        ...(line && !title.includes(words[0])
          ? {
              excerpt: line
                .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|#+\s*|>\s*)/, '')
                .slice(0, 140),
            }
          : {}),
        score: titleHits * 10 - results.length * 0.01,
      });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 30);
  }

  /** Calls back when any page changes on disk, including from this store and other windows. */
  watch(onChange: () => void): void {
    let timer: NodeJS.Timeout | undefined;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 80);
    };
    void mkdir(this.folder, { recursive: true })
      .then(() => {
        this.watcher = watch(this.folder, { recursive: true }, fire);
        this.watcher.on('error', () => this.unwatch());
      })
      .catch(() => undefined);
  }
  unwatch(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  /**
   * The todo list from earlier versions of this extension, turned into today's page once.
   * The old file is renamed, never deleted.
   */
  async migrateTodos(legacy: string, day: string): Promise<string | undefined> {
    let text: string;
    try {
      text = await readFile(legacy, 'utf8');
    } catch {
      return undefined;
    }
    const body = text.replace(/\s*<!--[\s\S]*?-->/g, '').replace(/^## Done\b/m, '## Done earlier');
    const id = dailyId(day);
    const existing = (await this.exists(id)) ? await this.read(id) : dailyTemplate(day);
    const merged = `${existing.replace(/\s*$/, '')}\n\n## From your todo list\n\n${body
      .replace(/^##\s/gm, '### ')
      .trim()}\n`;
    await atomicWrite(this.file(id), merged);
    await rename(legacy, `${legacy}.migrated`);
    return id;
  }
}
