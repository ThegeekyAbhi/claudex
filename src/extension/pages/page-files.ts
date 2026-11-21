import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import { PageNotFound, type PageStore } from '../../infrastructure/pages/page-store';
import { PAGE_ID, pageFileName } from '../../shared/model';

/**
 * Pages open from `claudex-page:/Pages/<Title>.md?id=<id>`, so a tab and its breadcrumb read
 * as the page's name rather than a path deep in the extension's storage. The id in the query
 * names the file; the path is only for show, and a stale one (after a rename) still opens it.
 */
export const PAGE_SCHEME = 'claudex-page';
const FOLDER = '/Pages';

export function pageUri(id: string, title: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: PAGE_SCHEME,
    path: `${FOLDER}/${pageFileName(title)}`,
    query: `id=${encodeURIComponent(id)}`,
  });
}
/** The page an editor's URI shows, if it is one of yours. */
export function pageIdOfUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== PAGE_SCHEME) return undefined;
  const id = new URLSearchParams(uri.query).get('id') ?? '';
  return PAGE_ID.test(id) ? id : undefined;
}

/** Reads and writes your pages through the store, which keeps them as ordinary `.md` files. */
export class PageFileSystem implements vscode.FileSystemProvider {
  private changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  constructor(private store: PageStore) {}

  /** Pages changed on disk: open ones reload unless you have unsaved edits. */
  changed(uris: readonly vscode.Uri[]): void {
    if (uris.length)
      this.changes.fire(uris.map((uri) => ({ type: vscode.FileChangeType.Changed, uri })));
  }
  watch(): vscode.Disposable {
    // The store's own watcher reports changes, through `changed`.
    return new vscode.Disposable(() => undefined);
  }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const id = pageIdOfUri(uri);
    if (!id) {
      if (uri.path === '/' || uri.path === FOLDER)
        return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    try {
      const info = await stat(this.store.file(id));
      return {
        type: vscode.FileType.File,
        ctime: info.ctimeMs,
        mtime: info.mtimeMs,
        size: info.size,
      };
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }
  readDirectory(): [string, vscode.FileType][] {
    // A page's path is only its name; listing them is the Pages picker's job.
    return [];
  }
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const id = this.idOf(uri);
    try {
      return Buffer.from(await this.store.read(id), 'utf8');
    } catch (error) {
      if (error instanceof PageNotFound) throw vscode.FileSystemError.FileNotFound(uri);
      throw error;
    }
  }
  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const id = this.idOf(uri);
    const exists = await this.store.exists(id);
    if (!exists && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
    if (exists && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    await this.store.write(id, Buffer.from(content).toString('utf8'));
    this.changed([uri]);
  }
  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
  delete(uri: vscode.Uri): void {
    // Pages go to the trash from the Pages picker, where they can be restored.
    throw vscode.FileSystemError.NoPermissions(uri);
  }
  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
  private idOf(uri: vscode.Uri): string {
    const id = pageIdOfUri(uri);
    if (!id) throw vscode.FileSystemError.FileNotFound(uri);
    return id;
  }
}
