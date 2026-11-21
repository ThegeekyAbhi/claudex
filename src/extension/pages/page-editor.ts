import * as vscode from 'vscode';
import { pageTitle, splitFrontMatter, withPageMeta } from '../../shared/model';
import {
  type PagePlan,
  type PageViewAction,
  type PageWidth,
  pageViewActionSchema,
  type TableWidths,
} from '../../shared/protocol/pages';
import { webviewHtml } from '../surfaces';
import type { PagesContext, PageTarget } from './page-context';
import { replaceDocument } from './page-documents';
import type { Pages } from './pages';

export const PAGE_EDITOR = 'agentWorkspace.page';
/** Pages save themselves this long after you stop typing, as notes apps do. */
const AUTOSAVE_MS = 600;
const WIDTH_KEY = 'agentWorkspace.pageWidth';
const tableWidthsKey = (uri: vscode.Uri) => `agentWorkspace.tableWidths:${uri.toString()}`;

interface OpenPage {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  /** Set for one of your pages; unset for any other Markdown file opened with this editor. */
  id?: string;
  ready: boolean;
  /** The last text the editor sent, so its own edit isn't echoed back to it. */
  echo?: string;
  /** The plan state last sent, so a thread's progress redraws only the page it changes. */
  plan?: string;
}

/**
 * The page editor: a custom editor over the page's text document. VS Code keeps the document,
 * so undo, dirty state, hot exit and "Open as Markdown" next to it all work as for any file.
 */
export class PageEditorProvider implements vscode.CustomTextEditorProvider {
  private open = new Set<OpenPage>();
  private saves = new Map<vscode.TextDocument, NodeJS.Timeout>();
  constructor(
    private pages: Pages,
    private context: PagesContext,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const id = this.pages.idOfUri(document.uri);
    const page: OpenPage = { document, panel, ...(id ? { id } : {}), ready: false };
    this.open.add(page);
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media/mascot/icon.png');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        // Images in your pages; pages themselves never load as resources.
        vscode.Uri.file(this.pages.store.assets.folder),
        // Images agents made, shown in the page's chat.
        vscode.Uri.file(this.pages.chatImages),
      ],
    };
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri, 'page');
    const subscriptions = [
      panel.webview.onDidReceiveMessage((raw) => void this.receive(raw, page)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== document || !event.contentChanges.length) return;
        const text = document.getText();
        if (text === page.echo) return;
        page.echo = undefined;
        if (page.ready) void panel.webview.postMessage({ type: 'pageText', text });
      }),
      panel.onDidChangeViewState(() => {
        if (panel.active && id) void this.pages.refresh();
      }),
    ];
    panel.onDidDispose(() => {
      this.open.delete(page);
      for (const subscription of subscriptions) subscription.dispose();
    });
  }

  /** Threads, suggestions or the list of pages changed: every open page shows it. */
  refreshAll(): void {
    for (const page of this.open) if (page.ready) void this.post(page);
  }
  /** A thread changed: open plans whose Build bar would read differently are redrawn. */
  refreshPlans(): void {
    for (const page of this.open) {
      if (!page.ready || page.id) continue;
      if (JSON.stringify(this.planFor(page.document)) !== page.plan) void this.post(page);
    }
  }
  private planFor(document: vscode.TextDocument): PagePlan | undefined {
    return document.uri.scheme === 'file' ? this.context.planFor(document.uri.fsPath) : undefined;
  }
  private async post(page: OpenPage): Promise<void> {
    const text = page.document.getText();
    const path = page.id ? undefined : vscode.workspace.asRelativePath(page.document.uri);
    const state = await this.pages.viewState(page.id, path);
    const plan = this.planFor(page.document);
    page.plan = JSON.stringify(plan);
    const width = this.context.globalState.get<PageWidth>(WIDTH_KEY) === 'full' ? 'full' : 'normal';
    const tableWidths =
      this.context.state.get<TableWidths>(tableWidthsKey(page.document.uri)) ?? [];
    // Image paths are relative to the page; the base is the page's own folder.
    const folder = page.id?.includes('/')
      ? vscode.Uri.joinPath(vscode.Uri.file(this.pages.store.folder), page.id.split('/')[0])
      : vscode.Uri.file(this.pages.store.folder);
    await page.panel.webview.postMessage({
      type: 'page',
      state: {
        ...state,
        text,
        width,
        tableWidths,
        ...(plan ? { plan } : {}),
        ...(path ? { path } : {}),
        ...(page.id ? { assetBase: `${page.panel.webview.asWebviewUri(folder).toString()}/` } : {}),
        imageBase: `${page.panel.webview.asWebviewUri(vscode.Uri.file(this.pages.chatImages)).toString()}/`,
      },
    });
  }

  private async receive(raw: unknown, page: OpenPage): Promise<void> {
    try {
      await this.handle(pageViewActionSchema.parse(raw), page);
    } catch (error) {
      const text =
        error instanceof Error && error.name === 'ZodError'
          ? 'That request wasn’t understood.'
          : error instanceof Error
            ? error.message
            : String(error);
      await page.panel.webview.postMessage({ type: 'error', text });
      this.context.output.appendLine(`Page: ${text}`);
    }
  }
  private async handle(action: PageViewAction, page: OpenPage): Promise<void> {
    const { document } = page;
    switch (action.type) {
      case 'ready':
        page.ready = true;
        await this.post(page);
        return;
      case 'pageEdit': {
        if (action.text === document.getText()) return;
        page.echo = action.text;
        if (!(await replaceDocument(document, action.text)))
          throw new Error('The page couldn’t be changed. It may be read-only.');
        // Only your pages save themselves; other files save the way you have VS Code set up.
        if (page.id) this.scheduleSave(document);
        return;
      }
      case 'pageAsk': {
        if (!vscode.workspace.isTrusted)
          throw new Error('Trust this workspace to work on pages with an agent.');
        if (document.isDirty) await document.save();
        await this.pages.ask(
          {
            ...this.target(page),
            title: pageTitle(splitFrontMatter(document.getText()).body),
          },
          action.prompt,
          page.panel.webview,
          action.profile,
          action.mode,
        );
        return;
      }
      case 'pageReply':
        if (!vscode.workspace.isTrusted)
          throw new Error('Trust this workspace to work on pages with an agent.');
        if (document.isDirty) await document.save();
        await this.pages.reply(
          this.target(page),
          action.threadId,
          action.prompt,
          page.panel.webview,
        );
        return;
      case 'pageStop':
        await this.pages.stop(this.target(page), action.threadId, page.panel.webview);
        return;
      case 'pageThread':
        this.pages.showThread(this.target(page), action.threadId);
        return;
      case 'pageSearchFiles': {
        const matches = vscode.workspace.isTrusted
          ? await this.pages.searchFiles(action.query)
          : [];
        await page.panel.webview.postMessage({
          type: 'pageFileResults',
          requestId: action.requestId,
          matches,
        });
        return;
      }
      case 'pageResolvePaths': {
        const paths = vscode.workspace.isTrusted ? await this.pages.resolvePaths(action.paths) : [];
        await page.panel.webview.postMessage({
          type: 'pagePathsResolved',
          requestId: action.requestId,
          paths,
        });
        return;
      }
      case 'pageImage': {
        try {
          if (!page.id) throw new Error('Images can be added to your pages only.');
          const src = await this.pages.saveImage(page.id, action.mime, action.data);
          await page.panel.webview.postMessage({
            type: 'pageImageSaved',
            requestId: action.requestId,
            src,
          });
        } catch (error) {
          await page.panel.webview.postMessage({
            type: 'pageImageFailed',
            requestId: action.requestId,
            text: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'pageAddChatImage': {
        if (!page.id) throw new Error('Images can be added to your pages only.');
        const src = await this.pages.addChatImage(page.id, action.file);
        await page.panel.webview.postMessage({
          type: 'pageInsertImage',
          src,
          alt: (action.alt ?? '').replace(/[[\]\n]/g, ' ').trim(),
        });
        return;
      }
      case 'pageSuggestion':
        await this.pages.resolveSuggestion(action.id, action.accept, action.index);
        return;
      case 'pageCarry': {
        if (!page.id) return;
        const count = await this.pages.carry(page.id);
        if (!count) throw new Error('There are no unfinished tasks to bring over.');
        await this.post(page);
        return;
      }
      case 'pageIcon':
        await replaceDocument(document, withPageMeta(document.getText(), { icon: action.icon }));
        if (page.id) this.scheduleSave(document);
        return;
      case 'pageOpenText':
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
        return;
      case 'pageOpen':
        await this.pages.open(action.id);
        return;
      case 'openChat':
        await this.context.openChat(action.id);
        return;
      case 'link':
        await this.context.link(action.href);
        return;
      case 'pageAllPages':
        this.pages.openOverview();
        return;
      case 'pageWidth':
        await this.context.globalState.update(WIDTH_KEY, action.width);
        this.refreshAll();
        return;
      case 'pageTableWidths':
        // Only the view remembers these; the document keeps its plain Markdown table.
        await this.context.state.update(
          tableWidthsKey(document.uri),
          action.widths.some((widths) => widths?.some(Boolean)) ? action.widths : undefined,
        );
        return;
      case 'pagePlanBuild': {
        if (!vscode.workspace.isTrusted)
          throw new Error('Trust this workspace to build a plan with an agent.');
        const plan = this.planFor(document);
        if (plan?.threadId !== action.threadId)
          throw new Error('This page isn’t that thread’s plan.');
        // Build what you see: the page's last edits are in the document; save them first.
        if (document.isDirty) await document.save();
        const { type: _, threadId, ...choice } = action;
        try {
          await this.context.buildPlan(threadId, choice);
        } finally {
          // Success or failure, the bar redraws from the thread's real state.
          await this.post(page);
        }
        return;
      }
    }
  }
  private target(page: OpenPage): PageTarget {
    return page.id ? { id: page.id } : { path: vscode.workspace.asRelativePath(page.document.uri) };
  }
  private scheduleSave(document: vscode.TextDocument): void {
    const pending = this.saves.get(document);
    if (pending) clearTimeout(pending);
    this.saves.set(
      document,
      setTimeout(() => {
        this.saves.delete(document);
        if (document.isDirty && !document.isClosed) void document.save();
      }, AUTOSAVE_MS),
    );
  }
}
