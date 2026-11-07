import path from 'node:path';
import * as vscode from 'vscode';
import { createAgentFactory, Sessions } from '../application/sessions/session-manager';
import { ImageStore } from '../providers/shared/image-store';
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  parseAppearance,
  parseCrossAgentContext,
} from '../shared/domain/preferences';
import {
  agentKind,
  canRun,
  INSTALL_HELP,
  type Provider,
  type Session,
  type Snapshot,
  type SnapshotUpdate,
  sessionsForView,
  setupRows,
  skillsFor,
  tailStart,
} from '../shared/model';
import type { HandlersFor } from './action-groups';
import { readAtRevision } from './changes';
import { listDocuments } from './documents';
import { AttachmentsHandlers } from './handlers/attachments';
import { CatalogHandlers } from './handlers/catalog';
import { DocumentsHandlers } from './handlers/documents';
import { PlansHandlers } from './handlers/plans';
import { ProfilesHandlers } from './handlers/profiles';
import { TerminalHandlers } from './handlers/terminal';
import { ThreadsHandlers } from './handlers/threads';
import { launcherFor } from './launcher';
import { NativeHistory } from './native-history';
import { restoredThreadId } from './panel-state';
import { PlanStore } from './plans';
import { type ActionRoutes, routeAction } from './router';
import {
  CHAT_VIEW,
  FALLBACK_VIEW,
  PANEL_VIEW_TYPE,
  type Surface,
  Surfaces,
  supportsSecondarySidebar,
} from './surfaces';
import { TerminalCapture } from './terminal-capture';
import { WorkspaceSearch } from './workspace-search';

/** Global, so closing first-run setup once covers every folder. */
const ONBOARDING_DISMISSED = 'agentWorkspace.onboardingDismissed';

export class WorkspaceController {
  private routes: ActionRoutes;
  private catalogHandlers: CatalogHandlers;
  private profilesHandlers: ProfilesHandlers;
  private threadsHandlers: ThreadsHandlers;
  private plansHandlers: PlansHandlers;
  private documentsHandlers: DocumentsHandlers;
  private attachmentsHandlers: AttachmentsHandlers;
  private terminalHandlers: TerminalHandlers;
  private sessions: Sessions;
  private images: ImageStore;
  private surfaces: Surfaces;
  private search = new WorkspaceSearch();
  private terminalCapture = new TerminalCapture((text) => this.output.appendLine(text));
  private pendingDrafts = new Map<string, string>();
  private selectedId?: string;
  private updateTimer?: NodeJS.Timeout;
  private publishVersion = 0;
  private lastSent = new WeakMap<
    Surface,
    {
      selectedId?: string;
      status?: Session['status'];
      messages: number;
      surfaces: number;
      catalog: number;
      skills: number;
      documents?: Snapshot['documents'];
    }
  >();
  private cachedDocuments = new Map<string, Awaited<ReturnType<typeof listDocuments>>>();
  private documentWatchers = new Map<string, vscode.FileSystemWatcher>();
  private terminals = new Map<string, { terminal: vscode.Terminal; openedAt: number }>();
  private history: NativeHistory;
  private bases = new Map<string, string>();
  private plans: PlanStore;
  private subscriptions: vscode.Disposable[] = [];
  private output = vscode.window.createOutputChannel('Claudex');
  private statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  constructor(private context: vscode.ExtensionContext) {
    const storage =
      context.storageUri ?? vscode.Uri.joinPath(context.globalStorageUri, 'no-workspace');
    this.images = new ImageStore(path.join(storage.fsPath, 'images'));
    this.surfaces = new Surfaces(context.extensionUri, this.images.folder, (raw, surface) => {
      void this.receive(raw, surface);
    });
    this.plans = new PlanStore(path.join(storage.fsPath, 'plans'));
    this.sessions = new Sessions(
      storage.fsPath,
      createAgentFactory(launcherFor, this.images, (session) =>
        skillsFor(this.catalogHandlers.skills, agentKind(session)).skills.filter(
          (skill) => skill.enabled,
        ),
      ),
      undefined,
      this.plans,
      () => this.preferences().guidedPlanning,
      () => this.preferences().richExplanations,
    );

    const controller = this;
    this.catalogHandlers = new CatalogHandlers({
      sessions: this.sessions,
      output: this.output,
      scheduleUpdate: this.scheduleUpdate.bind(this),
      surfaces: this.surfaces,
    });
    this.profilesHandlers = new ProfilesHandlers({
      loadAgents: this.catalogHandlers.loadAgents.bind(this.catalogHandlers),
      loadCatalog: this.catalogHandlers.loadCatalog.bind(this.catalogHandlers),
      get agents() {
        return controller.catalogHandlers.agents;
      },
      sessions: this.sessions,
      skillLoads: this.catalogHandlers.skillLoads,
    });
    this.threadsHandlers = new ThreadsHandlers({
      sessions: this.sessions,
      images: this.images,
      terminalCapture: this.terminalCapture,
      selected: this.selected.bind(this),
      requireAgent: this.catalogHandlers.requireAgent.bind(this.catalogHandlers),
      checkSkills: this.catalogHandlers.checkSkills.bind(this.catalogHandlers),
      modelOption: this.catalogHandlers.modelOption.bind(this.catalogHandlers),
      setThinking: this.catalogHandlers.setThinking.bind(this.catalogHandlers),
      select: this.select.bind(this),
      publish: this.publish.bind(this),
      output: this.output,
      pendingDrafts: this.pendingDrafts,
      deliverDrafts: this.deliverDrafts.bind(this),
      terminals: this.terminals,
      surfaces: this.surfaces,
      catchUp: (id) => this.history.catchUp(id),
    });
    this.plansHandlers = new PlansHandlers({
      sessions: this.sessions,
      startThread: this.threadsHandlers.startThread.bind(this.threadsHandlers),
      terminals: this.terminals,
      requireAgent: this.catalogHandlers.requireAgent.bind(this.catalogHandlers),
      cachedDocuments: this.cachedDocuments,
      surfaces: this.surfaces,
      publish: this.publish.bind(this),
    });
    this.documentsHandlers = new DocumentsHandlers({
      sessions: this.sessions,
      documentRoot: this.documentRoot.bind(this),
      cachedDocuments: this.cachedDocuments,
      surfaces: this.surfaces,
      publish: this.publish.bind(this),
      requireAgent: this.catalogHandlers.requireAgent.bind(this.catalogHandlers),
      select: this.select.bind(this),
      pendingDrafts: this.pendingDrafts,
      deliverDrafts: this.deliverDrafts.bind(this),
      bases: this.bases,
      globalState: this.context.globalState,
    });
    this.attachmentsHandlers = new AttachmentsHandlers({
      sessions: this.sessions,
      surfaces: this.surfaces,
      documentRoot: this.documentRoot.bind(this),
      search: this.search,
      terminalCapture: this.terminalCapture,
      images: this.images,
    });
    this.history = new NativeHistory({
      sessions: this.sessions,
      output: this.output,
      extension: this.context,
      publish: this.publish.bind(this),
    });
    this.terminalHandlers = new TerminalHandlers({
      sessions: this.sessions,
      terminals: this.terminals,
      output: this.output,
      extension: this.context,
      history: this.history,
      select: this.select.bind(this),
      publish: this.publish.bind(this),
    });
    this.routes = {
      unrestricted: this.surfaceHandlers(),
      profiles: this.profilesHandlers.handlers(),
      workspace: {
        ...this.catalogHandlers.handlers(),
        ...this.threadsHandlers.handlers(),
        ...this.plansHandlers.handlers(),
        ...this.documentsHandlers.handlers(),
        ...this.attachmentsHandlers.handlers(),
        ...this.terminalHandlers.handlers(),
      },
      requireTrust: () => this.requireTrust(),
    };
  }
  private preferences(): Preferences {
    const config = vscode.workspace.getConfiguration('agentWorkspace');
    return {
      appearance: parseAppearance(config.get('appearance')),
      guidedPlanning: config.get<boolean>('guidedPlanning', DEFAULT_PREFERENCES.guidedPlanning),
      richExplanations: config.get<boolean>(
        'richExplanations',
        DEFAULT_PREFERENCES.richExplanations,
      ),
      crossAgentContext: parseCrossAgentContext(config.get('crossAgentContext')),
    };
  }
  async initialize(): Promise<void> {
    await this.sessions.load();
    void this.catalogHandlers.loadAgents();
    this.selectedId = this.context.workspaceState.get<string>('selectedId');
    this.sessions.on('change', (full?: boolean) => {
      // Delayed observations can be inserted before the normal streaming tail.
      if (full) this.lastSent = new WeakMap();
      this.scheduleUpdate();
    });
    this.sessions.on('storageError', (error) => {
      this.output.appendLine(String(error));
      void vscode.window.showErrorMessage(
        'Claudex could not save session history. Check the output panel.',
      );
    });
    await vscode.commands.executeCommand(
      'setContext',
      'agentWorkspace.noSecondarySidebar',
      !supportsSecondarySidebar(),
    );
    const viewProvider: vscode.WebviewViewProvider = {
      resolveWebviewView: (view) => {
        const surface = this.surfaces.attach(view.webview, 'view');
        surface.selectedId = this.selectedId;
        view.onDidDispose(() => this.surfaces.remove(surface));
      },
    };
    const viewOptions = { webviewOptions: { retainContextWhenHidden: true } };
    this.subscriptions.push(
      vscode.window.registerWebviewViewProvider(CHAT_VIEW, viewProvider, viewOptions),
      vscode.window.registerWebviewViewProvider(FALLBACK_VIEW, viewProvider, viewOptions),
      vscode.commands.registerCommand('agentWorkspace.openInEditor', () =>
        this.surfaces.openInEditor(),
      ),
      // Without this, chat tabs VS Code reopens after a reload or update stay blank.
      vscode.window.registerWebviewPanelSerializer(PANEL_VIEW_TYPE, {
        deserializeWebviewPanel: async (panel, state) => {
          const id = restoredThreadId(state, (candidate) =>
            this.sessions.sessions.some((session) => session.id === candidate),
          );
          this.surfaces.restorePanel(panel, id);
        },
      }),
      vscode.window.onDidStartTerminalShellExecution((event) => {
        void this.terminalCapture.capture(event);
      }),
      this.output,
      this.statusItem,
      // Editor toolbar buttons pass the active file's URI, which is not a thread ID.
      vscode.commands.registerCommand('agentWorkspace.open', (id?: unknown) =>
        this.open(typeof id === 'string' ? id : undefined),
      ),
      vscode.commands.registerCommand('agentWorkspace.new', () => this.compose()),
      vscode.commands.registerCommand('agentWorkspace.checkAgents', () => this.checkAgents()),
      vscode.commands.registerCommand('agentWorkspace.signIn', (id?: unknown) =>
        this.signInCommand(id),
      ),
      vscode.commands.registerCommand('agentWorkspace.refresh', () => this.publish()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.publish()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('agentWorkspace')) return;
        const agentSettings = [
          'profiles',
          'claudePath',
          'codexPath',
          'claud2Path',
          'claud2ConfigDir',
        ];
        if (agentSettings.some((key) => event.affectsConfiguration(`agentWorkspace.${key}`)))
          void this.catalogHandlers.loadAgents().then(() => {
            if (vscode.workspace.isTrusted) void this.catalogHandlers.loadCatalog(true);
          });
        else void this.publish();
      }),
      // Coming back to VS Code is when a terminal session elsewhere has most likely moved on.
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) return;
        if (this.selectedId) this.syncInBackground(this.selectedId);
        void this.history.refresh().catch((error) => this.output.appendLine(String(error)));
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [id, active] of this.terminals)
          if (terminal === active.terminal) {
            this.terminals.delete(id);
            void this.terminalHandlers.returnFromTerminal(id);
          }
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        for (const tab of event.closed) {
          if (!(tab.input instanceof vscode.TabInputTextDiff)) continue;
          for (const uri of [tab.input.original, tab.input.modified]) {
            const used = vscode.window.tabGroups.all.some((group) =>
              group.tabs.some(
                (open) =>
                  open.input instanceof vscode.TabInputTextDiff &&
                  [open.input.original.toString(), open.input.modified.toString()].includes(
                    uri.toString(),
                  ),
              ),
            );
            if (!used) this.bases.delete(uri.toString());
          }
        }
      }),
      vscode.workspace.registerTextDocumentContentProvider('agent-workspace-base', {
        provideTextDocumentContent: async (uri) => {
          const stored = this.bases.get(uri.toString());
          if (stored !== undefined) return stored;
          // The Changes editor names the commit instead of storing content; see reviewAll.
          const revision = new URLSearchParams(uri.query).get('ref');
          return revision ? readAtRevision(uri.fsPath, revision) : '';
        },
      }),
    );
    this.watchDocuments();
    this.statusItem.name = 'Claudex';
    this.statusItem.command = 'agentWorkspace.open';
    this.updateStatusItem();
    this.statusItem.show();
    this.context.subscriptions.push(...this.subscriptions);
  }
  private requireTrust(): void {
    if (!vscode.workspace.isTrusted)
      throw new Error('Trust this workspace before running agents or opening project documents.');
  }
  private selected(): Session | undefined {
    return this.sessions.sessions.find((session) => session.id === this.selectedId);
  }
  private documentRoot(): string | undefined {
    return this.selected()?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
  private watchDocuments(): void {
    if (!vscode.workspace.isTrusted) return;
    const roots = new Set(this.sessions.sessions.map((session) => session.cwd));
    for (const folder of vscode.workspace.workspaceFolders ?? []) roots.add(folder.uri.fsPath);
    for (const root of roots)
      if (!this.documentWatchers.has(root)) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(root, 'docs/agent-work/**/*.md'),
        );
        for (const event of [watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete])
          this.subscriptions.push(
            event(() => {
              this.cachedDocuments.delete(root);
              this.scheduleUpdate();
            }),
          );
        this.documentWatchers.set(root, watcher);
      }
  }
  private scheduleUpdate(): void {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      void this.publish().catch((error) => this.output.appendLine(String(error)));
    }, 50);
  }
  private updateStatusItem(): void {
    const active = this.sessions.sessions.filter((session) =>
      ['running', 'waiting'].includes(session.status),
    ).length;
    this.statusItem.text = active ? `$(sparkle) ${active}` : '$(sparkle)';
    this.statusItem.tooltip = active
      ? `Claudex: ${active} active ${active === 1 ? 'thread' : 'threads'}`
      : 'Open Claudex';
  }
  /**
   * Sends only what changed while a thread streams: its tail, and catalog or documents when new.
   * Anything structural (a new surface, another thread, a status change) sends everything.
   */
  private async publish(full = false): Promise<void> {
    this.updateStatusItem();
    this.watchDocuments();
    if (!this.surfaces.size) return;
    const version = ++this.publishVersion;
    for (const surface of this.surfaces) {
      const selectedId = surface.selectedId;
      const session = this.sessions.sessions.find((item) => item.id === selectedId);
      const root = session?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let documents = root ? this.cachedDocuments.get(root) : [];
      try {
        if (root && vscode.workspace.isTrusted && !documents) {
          documents = await listDocuments(root);
          this.cachedDocuments.set(root, documents);
        }
      } catch (error) {
        this.output.appendLine(`Documents: ${String(error)}`);
      }
      if (version !== this.publishVersion) return;
      const last = this.lastSent.get(surface);
      const streaming =
        !full &&
        session &&
        last?.selectedId === session.id &&
        last.status === session.status &&
        last.surfaces === this.surfaces.size &&
        session.messages.length >= last.messages;
      const from = streaming ? Math.min(tailStart(session.messages), last.messages) : undefined;
      const sessions = sessionsForView(this.sessions.sessions, selectedId).map((item) =>
        from !== undefined && item.id === session?.id
          ? { ...item, messages: item.messages.slice(from) }
          : item,
      );
      const update: SnapshotUpdate = {
        sessions,
        project: root ? path.basename(root) : 'Open a local folder',
        trusted: vscode.workspace.isTrusted,
        onboardingDismissed: this.context.globalState.get<boolean>(ONBOARDING_DISMISSED, false),
        nativeSessions: this.history.entries(),
        preferences: this.preferences(),
        ...(streaming && last.catalog === this.catalogHandlers.catalogVersion
          ? {}
          : { catalog: this.catalogHandlers.catalog }),
        ...(streaming && last.skills === this.catalogHandlers.skillsVersion
          ? {}
          : { skills: this.catalogHandlers.skills }),
        ...(streaming && last.catalog === this.catalogHandlers.catalogVersion
          ? {}
          : { agents: this.catalogHandlers.agents }),
        ...(streaming && last.documents === documents ? {} : { documents: documents ?? [] }),
      };
      this.lastSent.set(surface, {
        selectedId,
        status: session?.status,
        messages: session?.messages.length ?? 0,
        surfaces: this.surfaces.size,
        catalog: this.catalogHandlers.catalogVersion,
        skills: this.catalogHandlers.skillsVersion,
        documents,
      });
      void surface.webview.postMessage({
        type: 'snapshot',
        snapshot: update,
        selectedId,
        ...(from !== undefined && session ? { tail: { id: session.id, from } } : {}),
        imageBase: surface.webview.asWebviewUri(vscode.Uri.file(this.images.folder)).toString(),
      });
      if (surface.panel) surface.panel.title = session?.title ?? 'New chat';
    }
  }
  private async select(id?: string, surface = this.surfaces.active): Promise<void> {
    if (id) {
      this.sessions.get(id);
      this.syncInBackground(id);
    } else void this.history.follow(undefined);
    if (surface) surface.selectedId = id;
    this.selectedId = id;
    await this.context.workspaceState.update('selectedId', id);
  }
  /**
   * Brings in turns run elsewhere, such as a terminal, without holding up the click, and keeps
   * following this thread's transcript while it's open.
   */
  private syncInBackground(id: string): void {
    void this.history
      .follow(id)
      .catch((error) => this.output.appendLine(`History: ${String(error)}`));
    void this.history
      .sync(id)
      .then((outcome) => {
        if (outcome && (outcome.added || outcome.updated)) void this.publish(true);
      })
      .catch((error) => this.output.appendLine(`History: ${String(error)}`));
  }
  async open(id?: string): Promise<void> {
    if (id) await this.select(id);
    await this.surfaces.reveal();
    await this.publish();
  }
  private async receive(raw: unknown, surface: Surface): Promise<void> {
    try {
      this.surfaces.active = surface;
      this.selectedId = surface.selectedId;
      await routeAction(raw, surface, this.routes);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await surface.webview.postMessage({ type: 'error', text });
      this.output.appendLine(text);
    }
  }
  /** Opens an empty composer. A thread exists only once a message is sent. */
  async compose(): Promise<void> {
    this.requireTrust();
    await this.select(undefined);
    await this.open();
  }
  private async deliverDrafts(): Promise<void> {
    const ready = [...this.surfaces].filter((surface) => surface.ready);
    if (!ready.length) return;
    for (const [id, text] of this.pendingDrafts) {
      const delivered = await Promise.all(
        ready
          .filter((surface) => surface.selectedId === id)
          .map((surface) => surface.webview.postMessage({ type: 'draft', id, text })),
      );
      if (delivered.some(Boolean)) this.pendingDrafts.delete(id);
    }
  }

  private surfaceHandlers(): HandlersFor<'unrestricted'> {
    return {
      ready: async (_action, surface) => {
        surface.ready = true;
        await this.publish(true);
        await this.deliverDrafts();
        if (vscode.workspace.isTrusted) void this.catalogHandlers.loadCatalog();
        // Read-only: lists what the CLIs keep for this folder. It starts no agent turn.
        void this.history.refresh().catch((error) => this.output.appendLine(String(error)));
      },
      openChat: (action) => {
        if (action.id) this.sessions.get(action.id);
        this.surfaces.openInEditor(action.id);
      },
      select: async (action, surface) => {
        await this.select(action.id, surface);
        await this.publish();
      },
      setAppearance: async (action) => {
        await vscode.workspace
          .getConfiguration('agentWorkspace')
          .update('appearance', action.appearance, vscode.ConfigurationTarget.Global);
      },
      setGuide: async (action) => {
        await vscode.workspace
          .getConfiguration('agentWorkspace')
          .update(action.guide, action.enabled, vscode.ConfigurationTarget.Global);
      },
      // Your own choice, like appearance, so it needs no workspace trust.
      dismissOnboarding: async () => {
        await this.context.globalState.update(ONBOARDING_DISMISSED, true);
        await this.publish();
      },
    };
  }
  /** Re-detects the CLIs and says what was found, for the walkthrough's install step. */
  private async checkAgents(): Promise<void> {
    await this.catalogHandlers.loadAgents();
    if (vscode.workspace.isTrusted) void this.catalogHandlers.loadCatalog(true);
    const rows = setupRows(this.catalogHandlers.agents);
    const lines = rows.map((row) =>
      row.state === 'installed'
        ? `${row.label}: installed${row.version ? ` (${row.version})` : ''}.`
        : row.state === 'checking'
          ? `${row.label}: still checking.`
          : `${row.label}: ${row.problem ?? 'not found.'}`,
    );
    const message = lines.join(' ');
    if (rows.some((row) => row.state === 'installed'))
      void vscode.window.showInformationMessage(message);
    else void vscode.window.showWarningMessage(message);
  }
  /** Opens the CLI's own sign-in in a terminal. Nothing here sees or stores a credential. */
  private async signInCommand(id?: unknown): Promise<void> {
    const profiles = this.catalogHandlers.agents.profiles.filter(canRun);
    const chosen =
      typeof id === 'string'
        ? profiles.find((profile) => profile.id === id)
        : profiles.length === 1
          ? profiles[0]
          : (
              await vscode.window.showQuickPick(
                profiles.map((profile) => ({ label: profile.label, profile })),
                { title: 'Sign in to which agent?' },
              )
            )?.profile;
    if (typeof id === 'string' && !chosen) {
      void vscode.window.showWarningMessage(
        `${INSTALL_HELP[id as Provider]?.name ?? id} isn't installed yet. Install it first, then check again.`,
      );
      return;
    }
    if (chosen) this.profilesHandlers.signIn(chosen);
  }

  async dispose(): Promise<void> {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    for (const watcher of this.documentWatchers.values()) watcher.dispose();
    this.history.dispose();
    // Terminals belong to VS Code; leave their native sessions accessible.
    await this.sessions.dispose();
  }
}
