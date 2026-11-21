import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { localDay, PageNotFound, PageStore } from '../../infrastructure/pages/page-store';
import { dailyDay } from '../../shared/domain/pages/daily';
import type { PageEntry } from '../../shared/domain/pages/entry';
import { splitFrontMatter } from '../../shared/domain/pages/meta';
import { type PageStarter, starterBody } from '../../shared/domain/pages/starters';
import { carryOpenTasks } from '../../shared/domain/pages/tasks';
import type { PageToolName } from '../../shared/domain/pages/tools';
import { type Attachment, allProfiles, canRun } from '../../shared/model';
import type { PageAgentChoice, PageViewState } from '../../shared/protocol/pages';
import { PageAgentTools } from './page-agent-tools';
import { importImage, saveImage } from './page-assets';
import { addToToday, searchPages } from './page-commands';
import type { PagesContext, PageTarget } from './page-context';
import { closeTabs, replaceDocument, tabUri, tabUris } from './page-documents';
import { PAGE_EDITOR, PageEditorProvider } from './page-editor';
import { PAGE_SCHEME, PageFileSystem, pageIdOfUri, pageUri } from './page-files';
import { PAGES_FALLBACK_VIEW, PAGES_VIEW, PageLists } from './page-lists';
import { existingFiles } from './page-paths';
import { PageSuggestions } from './page-suggestions';
import { PageThreads } from './page-threads';

export type { PagesContext } from './page-context';
export { PAGES_FALLBACK_VIEW, PAGES_VIEW } from './page-lists';

const RECENTS = 'pages.recents';
const RECENT_LIMIT = 12;

/**
 * Pages: your Markdown notes for this workspace, a side bar to find them, and an editor tab to
 * write in. Agents read them and suggest edits; only you change the text.
 *
 * This is the one place the rest of the extension talks to. It owns the page list and opening
 * and changing pages; threads, suggestions, agent tools and the page lists are its collaborators.
 */
export class Pages {
  readonly store: PageStore;
  readonly editor: PageEditorProvider;
  readonly files: PageFileSystem;
  private readonly lists: PageLists;
  private readonly threads: PageThreads;
  private readonly suggestions: PageSuggestions;
  private readonly tools: PageAgentTools;
  private entries: PageEntry[] = [];
  version = 0;
  constructor(private context: PagesContext) {
    this.store = new PageStore(path.join(context.storage, 'pages'));
    this.editor = new PageEditorProvider(this, context);
    this.files = new PageFileSystem(this.store);
    const redraw = () => this.editor.refreshAll();
    this.lists = new PageLists(this, context);
    this.threads = new PageThreads(context, redraw);
    this.suggestions = new PageSuggestions(context.state, redraw);
    this.tools = new PageAgentTools({
      context,
      store: this.store,
      suggestions: this.suggestions,
      threads: this.threads,
      entries: () => this.entries,
      text: (id) => this.text(id),
      refresh: () => this.refresh(),
      imageRoots: () => this.imageRoots(),
    });
  }

  get list(): PageEntry[] {
    return this.entries;
  }
  register(): vscode.Disposable[] {
    const provider: vscode.WebviewViewProvider = {
      resolveWebviewView: (view) => this.lists.attach(view),
    };
    const options = { webviewOptions: { retainContextWhenHidden: true } };
    this.store.watch(() => this.refresh());
    void this.store
      .migrateTodos(path.join(this.context.storage, 'todos.md'), localDay())
      .then((id) => {
        if (id) this.context.output.appendLine('Pages: your todo list is now on today’s page.');
      })
      .catch((error) => this.context.output.appendLine(`Pages: ${String(error)}`))
      .finally(() => this.refresh());
    let threadTimer: NodeJS.Timeout | undefined;
    const sessionsChanged = () => {
      if (threadTimer) return;
      threadTimer = setTimeout(() => {
        threadTimer = undefined;
        this.editor.refreshAll();
      }, 250);
    };
    this.context.sessions.on('change', sessionsChanged);
    return [
      vscode.window.registerWebviewViewProvider(PAGES_VIEW, provider, options),
      vscode.window.registerWebviewViewProvider(PAGES_FALLBACK_VIEW, provider, options),
      vscode.workspace.registerFileSystemProvider(PAGE_SCHEME, this.files, {
        isCaseSensitive: true,
      }),
      vscode.window.registerCustomEditorProvider(PAGE_EDITOR, this.editor, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.lists.schedule()),
      vscode.commands.registerCommand('agentWorkspace.newPage', () => this.newPage()),
      vscode.commands.registerCommand('agentWorkspace.openToday', () => this.openToday()),
      vscode.commands.registerCommand('agentWorkspace.addToToday', () => addToToday(this)),
      vscode.commands.registerCommand('agentWorkspace.searchPages', () => this.searchPages()),
      vscode.commands.registerCommand('agentWorkspace.allPages', () => this.openOverview()),
      vscode.commands.registerCommand('agentWorkspace.openPageAsText', () =>
        this.activeId() ? this.openText(this.activeId() as string) : undefined,
      ),
      {
        dispose: () => {
          this.store.unwatch();
          this.context.sessions.off('change', sessionsChanged);
          this.lists.dispose();
          if (threadTimer) clearTimeout(threadTimer);
        },
      },
    ];
  }

  // ---- Opening -------------------------------------------------------------------------------

  /**
   * Where the page opens: the tab it already has, or a new address named after its title.
   * Reusing the open one keeps a single document per page after its title changes.
   */
  async uri(id: string): Promise<vscode.Uri> {
    const open = this.document(id)?.uri ?? tabUris().find((uri) => this.idOfUri(uri) === id);
    if (open) return open;
    const entry = await this.store.entry(id);
    if (!entry) throw new PageNotFound(id);
    return pageUri(id, entry.title);
  }
  /** The page a URI shows: a `claudex-page:` address, or the page's file itself. */
  idOfUri(uri: vscode.Uri): string | undefined {
    return pageIdOfUri(uri) ?? (uri.scheme === 'file' ? this.store.idOf(uri.fsPath) : undefined);
  }
  async open(id: string, column?: vscode.ViewColumn): Promise<void> {
    if (!(await this.store.exists(id))) throw new PageNotFound(id);
    await vscode.commands.executeCommand('vscode.openWith', await this.uri(id), PAGE_EDITOR, {
      viewColumn: column ?? vscode.ViewColumn.Active,
      preview: false,
    });
    await this.touch(id);
  }
  async openToday(): Promise<void> {
    await this.open(await this.store.daily(localDay()));
  }
  /**
   * A page named before it opens, so its tab is named from the start. The New page dialog sends
   * the name, icon and starter; from the command palette, VS Code's input box asks for the name.
   */
  async newPage(
    options: { title?: string; icon?: string; starter?: PageStarter } = {},
  ): Promise<void> {
    const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
    if (options.title?.trim()) {
      const id = await this.store.create(clean(options.title), starterBody(options.starter), {
        ...(options.icon ? { icon: options.icon } : {}),
      });
      await this.open(id);
      return;
    }
    const title = await vscode.window.showInputBox({
      title: 'New page',
      prompt: 'Name the page. You can rename it later by editing its heading.',
      placeHolder: 'Release plan',
      validateInput: (input) => (input.trim() ? undefined : 'Name the page first.'),
    });
    if (!title?.trim()) return;
    const id = await this.store.create(clean(title));
    await this.open(id);
  }
  async openText(id: string): Promise<void> {
    await vscode.window.showTextDocument(await this.uri(id), {
      viewColumn: vscode.ViewColumn.Beside,
    });
  }
  /** Every page, in an editor tab of its own. */
  openOverview(): void {
    this.lists.openOverview();
  }
  async searchPages(): Promise<void> {
    searchPages(this);
  }
  /** The page in the active editor tab, if it is one of yours. */
  activeId(): string | undefined {
    const uri = tabUri(vscode.window.tabGroups.activeTabGroup.activeTab);
    return uri ? this.idOfUri(uri) : undefined;
  }
  /** Pages you opened lately, newest first. */
  recents(): string[] {
    return this.context.state.get<string[]>(RECENTS, []);
  }
  private async touch(id: string): Promise<void> {
    const recents = [id, ...this.recents().filter((other) => other !== id)].slice(0, RECENT_LIMIT);
    await this.context.state.update(RECENTS, recents);
    this.lists.schedule();
  }

  // ---- Changing pages ------------------------------------------------------------------------

  /** The page's text, from its open document when there is one (it may not be saved yet). */
  async text(id: string): Promise<string> {
    const open = this.document(id);
    return open ? open.getText() : this.store.read(id);
  }
  document(id: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((document) => this.idOfUri(document.uri) === id);
  }
  /**
   * Changes a page. An open page changes through its document, so the change can be undone
   * there and the editor follows; a closed one is written in place.
   */
  async change(id: string, update: (text: string) => string): Promise<void> {
    const document = this.document(id);
    if (document) {
      await replaceDocument(document, update(document.getText()));
      await document.save();
      return;
    }
    const before = await this.store.read(id);
    const after = update(before);
    if (after !== before) await this.store.write(id, after);
  }
  async rename(id: string, title: string): Promise<void> {
    await this.change(id, (text) => {
      const { front, body } = splitFrontMatter(text);
      const clean = title.replace(/\s+/g, ' ').trim();
      return /^#\s+.*$/m.test(body)
        ? front + body.replace(/^#\s+.*$/m, `# ${clean}`)
        : `${front}# ${clean}\n\n${body}`;
    });
  }
  /** Moves a page to the trash, closing its tabs, with an Undo that restores it. */
  async trash(id: string): Promise<void> {
    await closeTabs((uri) => this.idOfUri(uri) === id);
    await this.store.trash(id);
    await this.context.state.update(
      RECENTS,
      this.recents().filter((other) => other !== id),
    );
    const restore = 'Undo';
    void vscode.window
      .showInformationMessage('Moved the page to the trash.', restore)
      .then(async (choice) => {
        if (choice === restore) await this.open(await this.store.restore(id));
      });
  }
  /** Something changed on disk: re-read the list, and tell everyone who shows it. */
  async refresh(): Promise<void> {
    // Open pages reload from disk, as files do, unless you have unsaved edits.
    this.files.changed(
      vscode.workspace.textDocuments
        .map((document) => document.uri)
        .filter((uri) => uri.scheme === PAGE_SCHEME),
    );
    const entries = await this.store.list();
    if (JSON.stringify(entries) !== JSON.stringify(this.entries)) {
      this.entries = entries;
      this.version++;
      this.context.changed();
    }
    this.lists.schedule();
    this.editor.refreshAll();
  }

  // ---- What a page editor shows ----------------------------------------------------------------

  /** A thread changed: open plan pages whose Build bar reads differently are redrawn. */
  refreshPlans(): void {
    this.editor.refreshPlans();
  }
  async viewState(
    id: string | undefined,
    path?: string,
  ): Promise<Omit<PageViewState, 'text' | 'width' | 'tableWidths' | 'plan'>> {
    const agents: PageAgentChoice[] = allProfiles()
      .filter(canRun)
      .map((profile) => ({ id: profile.id, label: profile.label, agent: profile.id }));
    const conversation = this.threads.conversation({ id, path });
    return {
      ...(id ? { id } : {}),
      ...(id ? { carry: await this.carryOffer(id) } : {}),
      suggestions: id ? this.suggestions.forPage(id) : [],
      threads: id ? this.threads.list(id) : [],
      agents,
      defaultProfile: this.threads.defaultProfile(),
      pages: this.entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        ...(entry.icon ? { icon: entry.icon } : {}),
      })),
      trusted: vscode.workspace.isTrusted,
      ...(conversation ? { conversation } : {}),
    };
  }
  /** On today's page, the unfinished tasks of the last daily page before it. */
  private async carryOffer(id: string): Promise<PageViewState['carry']> {
    const day = dailyDay(id);
    if (!day || day !== localDay()) return undefined;
    const previous = await this.store.previousDaily(day);
    if (!previous) return undefined;
    const entry =
      this.entries.find((item) => item.id === previous) ?? (await this.store.entry(previous));
    if (!entry?.openTasks) return undefined;
    return { from: previous, title: entry.title, count: entry.openTasks };
  }
  async carry(id: string): Promise<number> {
    const offer = await this.carryOffer(id);
    if (!offer) return 0;
    const from = await this.text(offer.from);
    const result = carryOpenTasks(from, await this.text(id));
    if (!result) return 0;
    await this.change(id, () => result.to);
    await this.change(offer.from, () => result.from);
    return result.count;
  }

  // ---- Page chat -------------------------------------------------------------------------------

  /** A thread was sent pages: each remembers it. */
  link(threadId: string, attachments?: Attachment[]): void {
    this.threads.link(threadId, attachments);
  }
  ask(
    target: PageTarget & { title: string },
    prompt: string,
    webview: vscode.Webview,
    profile?: string,
    mode?: 'ask' | 'auto',
  ): Promise<void> {
    return this.threads.ask(target, prompt, webview, profile, mode);
  }
  reply(target: PageTarget, threadId: string, prompt: string, webview: vscode.Webview) {
    return this.threads.reply(target, threadId, prompt, webview);
  }
  stop(target: PageTarget, threadId: string, webview: vscode.Webview) {
    return this.threads.stop(target, threadId, webview);
  }
  showThread(target: PageTarget, threadId?: string): void {
    this.threads.show(target, threadId);
  }

  // ---- Images, mentions and suggestions --------------------------------------------------------

  /** Saves an image for a page and returns its path, relative to that page. */
  saveImage(id: string, mime: string, base64: string): Promise<string> {
    return saveImage(this.store.assets, id, mime, base64);
  }
  searchFiles(query: string): Promise<{ path: string; name: string }[]> {
    return this.context.searchFiles(query);
  }
  /** Which of a page's path references are files in the workspace. */
  async resolvePaths(references: readonly string[]): Promise<string[]> {
    const root = this.context.workspaceRoot();
    return root ? existingFiles(root, references) : [];
  }
  /** Accepts or dismisses one edit of a suggestion, or all of it. */
  resolveSuggestion(id: string, accept: boolean, index?: number): Promise<void> {
    return this.suggestions.resolve(id, accept, index, (pageId, update) =>
      this.change(pageId, update),
    );
  }

  /** The chat's image store, where images agents made are kept. */
  get chatImages(): string {
    return path.join(this.context.storage, 'images');
  }
  /** Copies an image from the chat's store into a page's assets. */
  addChatImage(id: string, file: string): Promise<string> {
    return importImage(this.store.assets, id, path.join(this.chatImages, file), [this.chatImages]);
  }
  /**
   * Where images may be added to a page from: the workspace, the chat's own images, and the
   * folder Codex saves generated images in.
   */
  imageRoots(): string[] {
    const root = this.context.workspaceRoot();
    const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
    return [...(root ? [root] : []), this.chatImages, path.join(codexHome, 'generated_images')];
  }

  // ---- Agents ----------------------------------------------------------------------------------

  /** A page as an agent reads it, for an @ attachment. */
  forAgent(id: string): Promise<string> {
    return this.tools.forAgent(id);
  }
  /** One page tool call from a thread's agent. */
  agentTool(threadId: string, name: PageToolName, args: unknown): Promise<string> {
    return this.tools.run(threadId, name, args);
  }
}
