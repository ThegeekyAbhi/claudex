import * as vscode from 'vscode';
import { localDay } from '../../infrastructure/pages/page-store';
import { dailyId } from '../../shared/domain/pages/daily';
import { withPageMeta } from '../../shared/domain/pages/meta';
import {
  DEFAULT_OVERVIEW_VIEW,
  PAGES_FILTERS,
  PAGES_SORTS,
  type PagesListAction,
  type PagesListState,
  type PagesOverviewView,
  pagesListActionSchema,
} from '../../shared/protocol/pages';
import { webviewHtml } from '../surfaces';
import type { PagesContext } from './page-context';
import type { Pages } from './pages';

export const PAGES_VIEW = 'agentWorkspace.pages';
export const PAGES_FALLBACK_VIEW = 'agentWorkspace.pagesFallback';
const OVERVIEW_PANEL = 'agentWorkspace.pagesOverview';
const OVERVIEW = 'pages.overview';

/**
 * Everywhere your pages are listed: the Pages side bar, and the All pages tab. Each webview gets
 * the same list and may ask for the same things, so the two always agree.
 */
export class PageLists {
  private lists = new Set<vscode.Webview>();
  private timer?: NodeJS.Timeout;
  private overview?: vscode.WebviewPanel;
  constructor(
    private pages: Pages,
    private context: PagesContext,
  ) {}

  /** The side bar view. */
  attach(view: vscode.WebviewView): void {
    this.connect(view.webview, 'pages');
    view.onDidChangeVisibility(() => {
      if (view.visible) this.schedule();
    });
    view.onDidDispose(() => this.lists.delete(view.webview));
  }
  /** Every page in an editor tab of its own, like a page. One tab; asking again shows it. */
  openOverview(): void {
    if (this.overview) {
      this.overview.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      OVERVIEW_PANEL,
      'All pages',
      vscode.ViewColumn.Active,
      { retainContextWhenHidden: true },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media/mascot/icon.png');
    this.connect(panel.webview, 'pagesOverview');
    this.overview = panel;
    panel.onDidChangeViewState(() => {
      if (panel.visible) this.schedule();
    });
    panel.onDidDispose(() => {
      this.lists.delete(panel.webview);
      this.overview = undefined;
    });
  }
  private connect(webview: vscode.Webview, kind: 'pages' | 'pagesOverview'): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webview.html = webviewHtml(webview, this.context.extensionUri, kind);
    this.lists.add(webview);
    webview.onDidReceiveMessage((raw) => void this.receive(raw, webview));
  }
  /** Redraws every list soon, once, however many changes arrive. */
  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const webview of this.lists)
        void this.post(webview).catch((error) =>
          this.context.output.appendLine(`Pages: ${String(error)}`),
        );
    }, 60);
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.overview?.dispose();
  }
  /** The All pages view's sort and filter, as you last left them in this workspace. */
  private overviewView(): PagesOverviewView {
    const saved = this.context.state.get<Partial<PagesOverviewView>>(OVERVIEW, {});
    return {
      sort: PAGES_SORTS.find((sort) => sort === saved.sort) ?? DEFAULT_OVERVIEW_VIEW.sort,
      filter:
        PAGES_FILTERS.find((filter) => filter === saved.filter) ?? DEFAULT_OVERVIEW_VIEW.filter,
    };
  }
  async state(): Promise<PagesListState> {
    const today = localDay();
    const entries = this.pages.list;
    const ids = new Set(entries.map((entry) => entry.id));
    return {
      today,
      todayId: dailyId(today),
      pages: entries,
      recents: this.pages.recents().filter((id) => ids.has(id)),
      trash: await this.pages.store.trashed(),
      activeId: this.pages.activeId(),
      overview: this.overviewView(),
    };
  }

  private async receive(raw: unknown, webview: vscode.Webview): Promise<void> {
    try {
      await this.handle(pagesListActionSchema.parse(raw), webview);
    } catch (error) {
      const text =
        error instanceof Error && error.name === 'ZodError'
          ? 'That request wasn’t understood.'
          : error instanceof Error
            ? error.message
            : String(error);
      await webview.postMessage({ type: 'error', text });
      this.context.output.appendLine(`Pages: ${text}`);
    }
  }
  private async handle(action: PagesListAction, webview: vscode.Webview): Promise<void> {
    const pages = this.pages;
    switch (action.type) {
      case 'ready':
        await this.post(webview);
        return;
      case 'pageOpen':
        await pages.open(action.id);
        return;
      case 'pageNew':
        await pages.newPage(action);
        return;
      case 'pageToday':
        await pages.openToday();
        return;
      case 'pageRename':
        await pages.rename(action.id, action.title);
        return;
      case 'pagePin':
        await pages.change(action.id, (text) => withPageMeta(text, { pinned: action.pinned }));
        return;
      case 'pageDuplicate':
        await pages.open(await pages.store.duplicate(action.id));
        return;
      case 'pageTrash':
        await pages.trash(action.id);
        return;
      case 'pageRestore':
        await pages.open(await pages.store.restore(action.id));
        return;
      case 'pageDeleteForever': {
        const remove = 'Delete Forever';
        const choice = await vscode.window.showWarningMessage(
          'Delete this page for good? This can’t be undone.',
          { modal: true },
          remove,
        );
        if (choice === remove) await pages.store.deleteForever(action.id);
        this.schedule();
        return;
      }
      case 'pageOpenText':
        await pages.openText(action.id);
        return;
      case 'pageSearch':
        await webview.postMessage({
          type: 'pageSearchResults',
          query: action.query,
          results: await pages.store.search(action.query),
        });
        return;
      case 'pagesOverview':
        this.openOverview();
        return;
      case 'pagesOverviewView':
        await this.context.state.update(OVERVIEW, { sort: action.sort, filter: action.filter });
        this.schedule();
        return;
    }
  }
  private async post(webview: vscode.Webview): Promise<void> {
    await webview.postMessage({ type: 'pages', state: await this.state() });
  }
}
