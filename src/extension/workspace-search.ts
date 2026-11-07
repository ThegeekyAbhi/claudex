import path from 'node:path';
import * as vscode from 'vscode';
import { type ContextMatch, searchContext } from './attachments';

const CACHE_MS = 30_000;
const IGNORED =
  '**/{node_modules,.git,dist,build,out,.next,.turbo,coverage,target,__pycache__,.venv}/**';
/** File search for the @ menu. A short cache keeps typing from re-walking the workspace. */
export class WorkspaceSearch {
  private files = new Map<string, { at: number; files: Promise<string[]> }>();
  private list(root: string): Promise<string[]> {
    const cached = this.files.get(root);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.files;
    const files = Promise.resolve(
      vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*'), IGNORED, 20_000),
    ).then((uris) => uris.map((uri) => path.relative(root, uri.fsPath)));
    this.files.set(root, { at: Date.now(), files });
    return files;
  }
  async search(root: string, query: string): Promise<ContextMatch[]> {
    return searchContext(await this.list(root), query);
  }
  /** Open tabs inside this folder, the active one first. */
  recent(root: string): string[] {
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .sort((a, b) => Number(b.isActive) - Number(a.isActive))
      .flatMap((tab) =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file'
          ? [path.relative(root, tab.input.uri.fsPath)]
          : [],
      )
      .filter((file, index, all) => !file.startsWith('..') && all.indexOf(file) === index)
      .slice(0, 5);
  }
}
