import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { ImageStore, MAX_ATTACHED_IMAGE, resolveAttachments, searchContext } from './attachments';
import { collectChanges } from './changes';
import {
  createDocument,
  type DocumentKind,
  listDocuments,
  readDocument,
  resolveInside,
  savePlan,
} from './documents';
import {
  type Action,
  AGENT_KINDS,
  AGENT_LABELS,
  type AgentKind,
  type Attachment,
  actionSchema,
  agentKind,
  agentLabel,
  agentTarget,
  type Catalog,
  type ClaudeCommand,
  deriveTitle,
  type ModelOption,
  type Provider,
  type Session,
  type SessionInput,
  type Snapshot,
} from './model';
import { listClaudeModels, listCodexModels } from './providers/catalog';
import { createAgentFactory, type Launcher, Sessions } from './sessions';
import { createWorktree, git } from './worktrees';

let controller: WorkspaceController | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  controller = new WorkspaceController(context);
  try {
    await controller.initialize();
  } catch (error) {
    await vscode.window.showErrorMessage(`Agent Workspace could not initialize: ${String(error)}`);
    throw error;
  }
}
export async function deactivate(): Promise<void> {
  await controller?.dispose();
}

/** The secondary side bar accepts extension views from this version on. */
const SECONDARY_SIDEBAR = { major: 1, minor: 106 };
function supportsSecondarySidebar(): boolean {
  const [major, minor] = vscode.version.split('.').map(Number);
  return (
    major > SECONDARY_SIDEBAR.major ||
    (major === SECONDARY_SIDEBAR.major && minor >= SECONDARY_SIDEBAR.minor)
  );
}
const CHAT_VIEW = 'agentWorkspace.chat';
const FALLBACK_VIEW = 'agentWorkspace.chatFallback';
/** One open copy of the UI: the side bar view, or the large layout in an editor tab. */
interface Surface {
  kind: 'view' | 'panel';
  webview: vscode.Webview;
  ready: boolean;
}
class WorkspaceController {
  private sessions: Sessions;
  private images: ImageStore;
  private surfaces = new Set<Surface>();
  private panel?: vscode.WebviewPanel;
  private files = new Map<string, { at: number; files: Promise<string[]> }>();
  private terminalOutput = new WeakMap<vscode.Terminal, string>();
  private pendingDrafts = new Map<string, string>();
  private catalog: Catalog = {
    codex: { status: 'loading', models: [] },
    claude: { status: 'loading', models: [] },
    claud2: { status: 'loading', models: [] },
  };
  private catalogLoad?: Promise<void>;
  private selectedId?: string;
  private updateTimer?: NodeJS.Timeout;
  private publishVersion = 0;
  private cachedDocuments = new Map<string, Awaited<ReturnType<typeof listDocuments>>>();
  private documentWatchers = new Map<string, vscode.FileSystemWatcher>();
  private terminals = new Map<string, vscode.Terminal>();
  private bases = new Map<string, string>();
  private subscriptions: vscode.Disposable[] = [];
  private output = vscode.window.createOutputChannel('Agent Workspace');
  private statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  constructor(private context: vscode.ExtensionContext) {
    const storage =
      context.storageUri ?? vscode.Uri.joinPath(context.globalStorageUri, 'no-workspace');
    this.images = new ImageStore(path.join(storage.fsPath, 'images'));
    this.sessions = new Sessions(
      storage.fsPath,
      createAgentFactory((provider, command) => this.launcher(provider, command), this.images),
    );
  }
  async initialize(): Promise<void> {
    await this.sessions.load();
    this.selectedId = this.context.workspaceState.get<string>('selectedId');
    this.sessions.on('change', () => this.scheduleUpdate());
    this.sessions.on('storageError', (error) => {
      this.output.appendLine(String(error));
      void vscode.window.showErrorMessage(
        'Agent Workspace could not save session history. Check the output panel.',
      );
    });
    await vscode.commands.executeCommand(
      'setContext',
      'agentWorkspace.noSecondarySidebar',
      !supportsSecondarySidebar(),
    );
    const viewProvider: vscode.WebviewViewProvider = {
      resolveWebviewView: (view) => {
        const surface = this.attach(view.webview, 'view');
        view.onDidDispose(() => this.surfaces.delete(surface));
      },
    };
    const viewOptions = { webviewOptions: { retainContextWhenHidden: true } };
    this.subscriptions.push(
      vscode.window.registerWebviewViewProvider(CHAT_VIEW, viewProvider, viewOptions),
      vscode.window.registerWebviewViewProvider(FALLBACK_VIEW, viewProvider, viewOptions),
      vscode.commands.registerCommand('agentWorkspace.openInEditor', () => this.openInEditor()),
      vscode.window.onDidStartTerminalShellExecution((event) => {
        void this.captureTerminal(event);
      }),
      this.output,
      this.statusItem,
      // Editor toolbar buttons pass the active file's URI, which is not a thread ID.
      vscode.commands.registerCommand('agentWorkspace.open', (id?: unknown) =>
        this.open(typeof id === 'string' ? id : undefined),
      ),
      vscode.commands.registerCommand('agentWorkspace.new', () => this.compose()),
      vscode.commands.registerCommand('agentWorkspace.refresh', () => this.publish()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.publish()),
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [id, active] of this.terminals)
          if (terminal === active) {
            this.terminals.delete(id);
            this.sessions.get(id).status = 'interrupted';
            this.sessions.changed();
          }
      }),
      vscode.workspace.registerTextDocumentContentProvider('agent-workspace-base', {
        provideTextDocumentContent: (uri) => this.bases.get(uri.toString()) ?? '',
      }),
    );
    this.watchDocuments();
    this.statusItem.name = 'Agent Workspace';
    this.statusItem.command = 'agentWorkspace.open';
    this.updateStatusItem();
    this.statusItem.show();
    this.context.subscriptions.push(...this.subscriptions);
  }
  private findExecutable(command: string): string | undefined {
    for (const folder of (process.env.PATH ?? '')
      .split(path.delimiter)
      .concat([path.join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'])) {
      const candidate = path.join(folder, command);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }
  /** Shell aliases are invisible here, so a second account is launched by its config folder. */
  private launcher(provider: Provider, claudeCommand?: ClaudeCommand): Launcher {
    const settings = vscode.workspace.getConfiguration('agentWorkspace');
    const command = provider === 'claude' ? (claudeCommand ?? 'claude') : provider;
    const configured = settings.get<string>(`${command}Path`, command);
    if (configured !== command) return { executable: configured };
    if (command !== 'claud2') return { executable: this.findExecutable(command) ?? configured };
    const wrapper = this.findExecutable('claud2') ?? this.findExecutable('claude2');
    if (wrapper) return { executable: wrapper };
    const folder = settings
      .get<string>('claud2ConfigDir', '~/.claude-account2')
      .replace(/^~(?=$|\/)/, homedir());
    if (folder && existsSync(folder))
      return {
        executable: this.launcher('claude', 'claude').executable,
        env: { CLAUDE_CONFIG_DIR: folder },
      };
    return { executable: configured };
  }
  private loadCatalog(force = false): Promise<void> {
    if (this.catalogLoad && !force) return this.catalogLoad;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    const list = (agent: AgentKind): Promise<ModelOption[]> => {
      const target = agentTarget(agent);
      const launcher = this.launcher(target.provider, target.command);
      return target.provider === 'codex'
        ? listCodexModels(launcher.executable, cwd)
        : listClaudeModels(launcher.executable, cwd, launcher.env);
    };
    this.catalogLoad = Promise.all(
      AGENT_KINDS.map(async (agent) => {
        this.catalog[agent] = { status: 'loading', models: this.catalog[agent].models };
        try {
          this.catalog[agent] = { status: 'ready', models: await list(agent) };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          this.output.appendLine(`Models for ${AGENT_LABELS[agent]}: ${text}`);
          this.catalog[agent] = { status: 'error', models: [], error: text };
        }
        this.scheduleUpdate();
      }),
    ).then(() => undefined);
    return this.catalogLoad;
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
      ? `Agent Workspace: ${active} active ${active === 1 ? 'thread' : 'threads'}`
      : 'Open Agent Workspace';
  }
  private post(message: unknown): void {
    for (const surface of this.surfaces) void surface.webview.postMessage(message);
  }
  private async publish(): Promise<void> {
    this.updateStatusItem();
    this.watchDocuments();
    if (!this.surfaces.size) return;
    const version = ++this.publishVersion;
    const root = this.documentRoot();
    const snapshot: Snapshot = {
      // A selected thread sends its transcript; its children send enough for inline cards.
      sessions: this.sessions.sessions.map((session) =>
        session.id === this.selectedId
          ? session
          : {
              ...session,
              messages: session.parentId === this.selectedId ? session.messages.slice(-40) : [],
            },
      ),
      catalog: this.catalog,
      documents: [],
      project: root ? path.basename(root) : 'Open a local folder',
      trusted: vscode.workspace.isTrusted,
    };
    try {
      if (root && vscode.workspace.isTrusted) {
        snapshot.documents = this.cachedDocuments.get(root) ?? (await listDocuments(root));
        this.cachedDocuments.set(root, snapshot.documents);
      }
    } catch (error) {
      this.output.appendLine(`Documents: ${String(error)}`);
    }
    if (version !== this.publishVersion) return;
    for (const surface of this.surfaces)
      await surface.webview.postMessage({
        type: 'snapshot',
        snapshot,
        selectedId: this.selectedId,
        imageBase: surface.webview.asWebviewUri(vscode.Uri.file(this.images.folder)).toString(),
      });
  }
  private async select(id?: string): Promise<void> {
    if (id) this.sessions.get(id);
    this.selectedId = id;
    await this.context.workspaceState.update('selectedId', id);
  }
  private async reveal(): Promise<void> {
    if (this.panel?.visible) this.panel.reveal();
    else
      await vscode.commands.executeCommand(
        `${supportsSecondarySidebar() ? CHAT_VIEW : FALLBACK_VIEW}.focus`,
      );
  }
  /** Beside the editor-tab layout if it is open; otherwise in the center, where the code is. */
  private codeColumn(): vscode.ViewColumn {
    return this.panel ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  }
  async open(id?: string): Promise<void> {
    if (id) await this.select(id);
    await this.reveal();
    await this.publish();
  }
  private attach(webview: vscode.Webview, kind: Surface['kind']): Surface {
    const surface: Surface = { kind, webview, ready: false };
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.file(this.images.folder),
      ],
    };
    webview.html = this.html(webview, kind);
    this.surfaces.add(surface);
    webview.onDidReceiveMessage(async (raw) => {
      try {
        await this.action(actionSchema.parse(raw), surface);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await webview.postMessage({ type: 'error', text });
        this.output.appendLine(text);
      }
    });
    return surface;
  }
  async openInEditor(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'agentWorkspace',
      'Agent Workspace',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media/tab.svg');
    const surface = this.attach(panel.webview, 'panel');
    panel.onDidDispose(() => {
      this.surfaces.delete(surface);
      this.panel = undefined;
    });
  }
  private html(webview: vscode.Webview, kind: Surface['kind']): string {
    const nonce = randomUUID();
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist/webview.js'),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist/webview.css'),
    );
    return `<!doctype html><html lang="en" data-surface="${kind}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"><link rel="stylesheet" href="${style}"><title>Agent Workspace</title></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  /** Opens an empty composer. A thread exists only once a message is sent. */
  async compose(): Promise<void> {
    this.requireTrust();
    await this.select(undefined);
    await this.open();
  }
  private async input(attachments: Attachment[] | undefined, root: string): Promise<SessionInput> {
    if (!attachments?.length) return {};
    return resolveAttachments(attachments, {
      root,
      store: this.images,
      sessions: this.sessions.sessions,
      terminal: (name) => this.terminalText(name),
    });
  }
  private async captureTerminal(event: vscode.TerminalShellExecutionStartEvent): Promise<void> {
    let text = '';
    try {
      for await (const chunk of event.execution.read()) text = `${text}${chunk}`.slice(-20_000);
    } catch (error) {
      this.output.appendLine(`Terminal output: ${String(error)}`);
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: this removes terminal escape codes
    const clean = text.replace(/\u001b(?:\][^\u0007]*\u0007|\[[0-9;?]*[A-Za-z])/g, '');
    this.terminalOutput.set(event.terminal, `$ ${event.execution.commandLine.value}\n${clean}`);
  }
  private terminalText(name: string): string | undefined {
    const terminal = vscode.window.terminals.find((item) => item.name === name);
    if (!terminal) return undefined;
    return this.terminalOutput.get(terminal);
  }
  private workspaceFiles(root: string): Promise<string[]> {
    const cached = this.files.get(root);
    if (cached && Date.now() - cached.at < 30_000) return cached.files;
    const files = Promise.resolve(
      vscode.workspace.findFiles(
        new vscode.RelativePattern(root, '**/*'),
        '**/{node_modules,.git,dist,build,out,.next,.turbo,coverage,target,__pycache__,.venv}/**',
        20_000,
      ),
    ).then((uris) => uris.map((uri) => path.relative(root, uri.fsPath)));
    this.files.set(root, { at: Date.now(), files });
    return files;
  }
  private async searchContext(
    action: Extract<Action, { type: 'searchContext' }>,
    surface: Surface,
  ): Promise<void> {
    const root = this.documentRoot();
    const matches = root ? searchContext(await this.workspaceFiles(root), action.query) : [];
    const recent = root
      ? vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .sort((a, b) => Number(b.isActive) - Number(a.isActive))
          .flatMap((tab) =>
            tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file'
              ? [path.relative(root, tab.input.uri.fsPath)]
              : [],
          )
          .filter((file, index, all) => !file.startsWith('..') && all.indexOf(file) === index)
          .slice(0, 5)
      : [];
    await surface.webview.postMessage({
      type: 'contextResults',
      requestId: action.requestId,
      matches,
      recent,
      terminals: vscode.window.terminals
        .filter((terminal) => this.terminalOutput.has(terminal))
        .map((terminal) => terminal.name),
    });
  }
  private async addImage(
    bytes: Uint8Array,
    name: string,
    draftKey: string,
    surface: Surface,
  ): Promise<void> {
    const file = await this.images.save(bytes, MAX_ATTACHED_IMAGE);
    await surface.webview.postMessage({
      type: 'attached',
      draftKey,
      attachment: { kind: 'image', file, name },
    });
  }
  private async pickImages(draftKey: string, surface: Surface): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach',
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    });
    for (const uri of picked ?? []) {
      const { size } = await vscode.workspace.fs.stat(uri);
      if (size > MAX_ATTACHED_IMAGE) throw new Error('Images can be at most 10 MB.');
      await this.addImage(
        await vscode.workspace.fs.readFile(uri),
        path.basename(uri.fsPath),
        draftKey,
        surface,
      );
    }
  }
  private async chooseWorkspace(parent?: Session): Promise<string> {
    if (parent) return parent.workspace;
    const folders = vscode.workspace.workspaceFolders?.filter(
      (folder) => folder.uri.scheme === 'file',
    );
    if (!folders?.length) throw new Error('Open a local project folder first.');
    if (folders.length === 1) return folders[0].uri.fsPath;
    const current = this.selected()?.workspace;
    if (current && folders.some((folder) => folder.uri.fsPath === current)) return current;
    const editor = vscode.window.activeTextEditor?.document.uri;
    const active = editor && vscode.workspace.getWorkspaceFolder(editor);
    if (active) return active.uri.fsPath;
    const picked = await vscode.window.showWorkspaceFolderPick();
    if (!picked) throw new Error('Choose a project folder to start this thread.');
    return picked.uri.fsPath;
  }
  private modelOption(agent: AgentKind, model?: string | null): ModelOption | undefined {
    return model ? this.catalog[agent].models.find((item) => item.id === model) : undefined;
  }
  private async startThread(action: Extract<Action, { type: 'start' }>): Promise<void> {
    const parent = action.parentId ? this.sessions.get(action.parentId) : undefined;
    const workspace = await this.chooseWorkspace(parent);
    // Checked first, so a bad attachment keeps your draft and creates no thread.
    const input = await this.input(action.attachments, workspace);
    const cwd = action.worktree
      ? await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Creating agent worktree' },
          () => createWorktree(workspace),
        )
      : (parent?.cwd ?? workspace);
    const target = agentTarget(action.agent);
    const session = this.sessions.create(
      target.provider,
      cwd,
      workspace,
      deriveTitle(action.text),
      parent?.id,
      target.command,
    );
    this.sessions.setModel(
      session.id,
      action.model ?? null,
      action.effort ?? null,
      this.modelOption(action.agent, action.model)?.adaptiveThinking,
    );
    if (action.mode) this.sessions.setMode(session.id, action.mode);
    this.post({ type: 'sent', id: action.draftKey, text: action.text });
    await this.select(session.id);
    await this.publish();
    void this.sessions
      .send(session.id, action.text, input)
      .catch((error) => this.output.appendLine(String(error)));
  }
  /** A typed @mention is the user's own instruction, so it starts directly with no approval. */
  private async delegateFromUser(action: Extract<Action, { type: 'delegate' }>): Promise<void> {
    const parent = this.sessions.get(action.id);
    if (parent.observed) throw new Error('This worker is controlled by its main agent.');
    const input = await this.input(action.attachments, parent.workspace);
    const messageId = randomUUID();
    parent.messages.push({
      id: messageId,
      role: 'tool',
      text: '',
      startedAt: Date.now(),
      tool: {
        kind: 'agent',
        name: 'delegate',
        title: deriveTitle(action.text),
        status: 'running',
        input: action.text,
      },
    });
    const patch = (tool: Partial<NonNullable<Session['messages'][number]['tool']>>) => {
      const message = parent.messages.find((item) => item.id === messageId);
      if (message?.tool) message.tool = { ...message.tool, ...tool };
      this.sessions.changed();
    };
    this.sessions.changed();
    this.post({ type: 'sent', id: action.draftKey, text: action.text });
    void this.sessions
      .delegate(
        parent.id,
        { agent: action.agent, prompt: action.text },
        (sessionId) => patch({ workerId: sessionId }),
        input,
      )
      .then(
        (result) => patch({ status: result.status === 'completed' ? 'completed' : 'failed' }),
        (error) => {
          this.output.appendLine(String(error));
          patch({ status: 'failed' });
        },
      );
  }
  private async deliverDrafts(): Promise<void> {
    const ready = [...this.surfaces].filter((surface) => surface.ready);
    if (!ready.length) return;
    for (const [id, text] of this.pendingDrafts) {
      const delivered = await Promise.all(
        ready.map((surface) => surface.webview.postMessage({ type: 'draft', id, text })),
      );
      if (delivered.some(Boolean)) this.pendingDrafts.delete(id);
    }
  }
  private async action(action: Action, surface: Surface): Promise<void> {
    if (action.type === 'ready') {
      surface.ready = true;
      await this.publish();
      await this.deliverDrafts();
      if (vscode.workspace.isTrusted) void this.loadCatalog();
      return;
    }
    if (action.type === 'select') {
      await this.select(action.id);
      await this.publish();
      return;
    }
    this.requireTrust();
    switch (action.type) {
      case 'link': {
        if (/^https?:\/\//.test(action.href)) {
          await vscode.env.openExternal(vscode.Uri.parse(action.href));
          break;
        }
        const root = this.documentRoot();
        if (!root) throw new Error('Open a workspace first.');
        const match = /^(.*?)(?::(\d+))?$/.exec(decodeURIComponent(action.href));
        if (!match || /^[a-z]+:/i.test(match[1])) throw new Error('Unsupported link.');
        const target = await resolveInside(root, match[1]);
        const line = Math.max(0, Number(match[2] ?? 1) - 1);
        await vscode.window.showTextDocument(vscode.Uri.file(target), {
          viewColumn: this.codeColumn(),
          selection: new vscode.Range(line, 0, line, 0),
        });
        break;
      }
      case 'compose':
        // Stays on the surface you pressed it in.
        await this.select(undefined);
        await this.publish();
        break;
      case 'start':
        await this.startThread(action);
        break;
      case 'delegate':
        await this.delegateFromUser(action);
        break;
      case 'setModel': {
        const session = this.sessions.get(action.id);
        this.sessions.setModel(
          action.id,
          action.model,
          action.effort,
          this.modelOption(agentKind(session), action.model)?.adaptiveThinking,
        );
        break;
      }
      case 'refreshModels':
        void this.loadCatalog(true);
        break;
      case 'send': {
        const target = this.sessions.get(action.id);
        if (target.observed || ['running', 'waiting'].includes(target.status))
          throw new Error('This session cannot accept a message right now.');
        if (this.terminals.has(action.id))
          throw new Error('Close this session’s native terminal before resuming rich chat.');
        const input = await this.input(action.attachments, target.workspace);
        void this.sessions
          .send(action.id, action.text, input)
          .catch((error) => this.output.appendLine(String(error)));
        this.post({ type: 'sent', id: action.id, text: action.text });
        break;
      }
      case 'interrupt': {
        if (this.terminals.has(action.id)) {
          this.terminals.get(action.id)?.show();
          throw new Error('This session is in a native terminal. Use Ctrl+C there to stop it.');
        }
        await this.sessions.interrupt(action.id);
        break;
      }
      case 'approve':
        this.sessions.approve(action.id, action.requestId, action.allowed, action.answers);
        break;
      case 'rename': {
        const session = this.sessions.get(action.id);
        const title = await vscode.window.showInputBox({
          title: 'Rename session',
          value: session.title,
        });
        if (title?.trim()) this.sessions.setTitle(action.id, title.trim());
        break;
      }
      case 'document': {
        const root = this.documentRoot();
        if (!root) throw new Error('Open a workspace first.');
        await readDocument(root, action.path);
        const uri = vscode.Uri.file(await resolveInside(root, action.path));
        if (action.preview)
          await vscode.commands.executeCommand(
            this.panel ? 'markdown.showPreviewToSide' : 'markdown.showPreview',
            uri,
          );
        else await vscode.window.showTextDocument(uri, { viewColumn: this.codeColumn() });
        break;
      }
      case 'template':
        await this.newDocument(action.kind, action.id);
        break;
      case 'handoff':
        await this.handoff(action.id);
        break;
      case 'terminal':
        await this.terminal(action.id);
        break;
      case 'changes': {
        const session = this.sessions.get(action.id);
        await surface.webview.postMessage({
          type: 'changes',
          id: action.id,
          result: await collectChanges(session.cwd),
        });
        break;
      }
      case 'openDiff':
        await this.openDiff(action.id, action.file, action.original);
        break;
      case 'worktree':
        await this.continueInWorktree(action.id);
        break;
      case 'setMode':
        this.sessions.setMode(action.id, action.mode);
        break;
      case 'buildPlan':
        if (this.terminals.has(action.id))
          throw new Error('Close this session’s native terminal before resuming rich chat.');
        await this.sessions.buildPlan(action.id);
        break;
      case 'keepPlanning':
        this.sessions.keepPlanning(action.id);
        break;
      case 'savePlan': {
        const session = this.sessions.get(action.id);
        if (!session.plan) throw new Error('This thread has no plan to save.');
        const relative = await savePlan(session.cwd, session.title, session.plan.text);
        this.cachedDocuments.delete(session.cwd);
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(session.cwd, relative)), {
          viewColumn: this.codeColumn(),
        });
        await this.publish();
        break;
      }
      case 'copy':
        await vscode.env.clipboard.writeText(action.text);
        break;
      case 'searchContext':
        await this.searchContext(action, surface);
        break;
      case 'pickImages':
        await this.pickImages(action.draftKey, surface);
        break;
      case 'attachImage':
        await this.addImage(
          Buffer.from(action.data, 'base64'),
          action.name,
          action.draftKey,
          surface,
        );
        break;
      case 'openImage': {
        const uri = vscode.Uri.file(this.images.path(action.file));
        if (action.reveal) await vscode.commands.executeCommand('revealFileInOS', uri);
        else await vscode.commands.executeCommand('vscode.open', uri, this.codeColumn());
        break;
      }
    }
  }
  private async continueInWorktree(id: string): Promise<void> {
    const source = this.sessions.get(id);
    const cwd = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating agent worktree' },
      () => createWorktree(source.workspace),
    );
    const session = this.sessions.create(
      source.provider,
      cwd,
      source.workspace,
      `${source.title} (worktree)`,
      source.id,
      source.claudeCommand,
    );
    this.sessions.setModel(session.id, source.model ?? null, source.effort ?? null);
    await this.select(session.id);
    await this.publish();
    this.pendingDrafts.set(
      session.id,
      `Continue the task from the thread “${source.title}”. This worktree starts from committed HEAD, so uncommitted changes from that checkout are not here.`,
    );
    await this.deliverDrafts();
  }
  private async newDocument(kind: DocumentKind, id?: string): Promise<string | undefined> {
    const session = id ? this.sessions.get(id) : undefined;
    const root = session?.cwd ?? this.documentRoot();
    if (!root) throw new Error('Open a workspace first.');
    const title =
      kind === 'handoff' && session
        ? `${session.title} handoff`
        : await vscode.window.showInputBox({
            title: `New ${kind}`,
            value: session ? `${session.title} — ${kind}` : '',
            validateInput: (value) => (value.trim() ? undefined : 'Enter a title.'),
          });
    if (!title) return;
    const relative = await createDocument(root, kind, title.trim(), session);
    this.cachedDocuments.delete(root);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, relative)), {
      viewColumn: this.codeColumn(),
    });
    await this.publish();
    return relative;
  }
  private async handoff(id: string): Promise<void> {
    const session = this.sessions.get(id);
    const relative = await this.newDocument('handoff', id);
    if (!relative) return;
    const answer = await vscode.window.showInformationMessage(
      'Review and save the handoff document before opening a new provider session.',
      'Open new session',
    );
    if (!answer) return;
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(session.cwd, relative)),
    );
    if (document.isDirty) {
      await vscode.window.showInformationMessage('Save your handoff document before continuing.');
      return;
    }
    const provider: Provider = session.provider === 'codex' ? 'claude' : 'codex';
    const next = this.sessions.create(
      provider,
      session.cwd,
      session.workspace,
      `${session.title} (handoff)`,
      undefined,
      provider === 'claude' ? 'claude' : undefined,
    );
    await this.select(next.id);
    await this.publish();
    this.pendingDrafts.set(
      next.id,
      `Continue the work described in this user-reviewed handoff. Source document: ${path.join(session.cwd, relative)}\n\n${document.getText()}`,
    );
    await this.deliverDrafts();
  }
  private async terminal(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session.observed) throw new Error('Open the lead agent’s terminal to manage this worker.');
    if (!session.nativeId)
      throw new Error(
        'Send a first message in rich chat before resuming this thread in the native terminal.',
      );
    const existing = this.terminals.get(id);
    if (existing) {
      existing.show();
      return;
    }
    if (session.status === 'running' || session.status === 'waiting') {
      const choice = await vscode.window.showWarningMessage(
        'Stop this turn and continue in the native CLI?',
        { modal: true },
        'Stop and open terminal',
      );
      if (!choice) return;
      await this.sessions.interrupt(id);
    }
    await this.sessions.disconnect(id);
    const args = session.nativeId
      ? session.provider === 'codex'
        ? ['resume', session.nativeId]
        : ['--resume', session.nativeId]
      : [];
    const launcher = this.launcher(session.provider, session.claudeCommand);
    const terminal = vscode.window.createTerminal({
      name: `${agentLabel(session)} · ${session.title}`,
      cwd: session.cwd,
      shellPath: launcher.executable,
      shellArgs: args,
      ...(launcher.env ? { env: launcher.env } : {}),
    });
    session.messages.push({
      id: randomUUID(),
      role: 'notice',
      text: 'This thread was opened in the native CLI. Terminal activity is not mirrored here. Close the terminal before returning to rich chat; the provider retains its full conversation.',
    });
    this.terminals.set(id, terminal);
    session.status = 'running';
    this.sessions.changed();
    terminal.show();
  }
  private async openDiff(id: string, file: string, original?: string): Promise<void> {
    const session = this.sessions.get(id);
    const target = await resolveInside(session.cwd, file).catch(() => undefined);
    const before = await git(session.cwd, ['show', `HEAD:${original ?? file}`]).catch(() => '');
    const base = vscode.Uri.parse(`agent-workspace-base:/${randomUUID()}/${path.basename(file)}`);
    this.bases.set(base.toString(), before);
    let after: vscode.Uri;
    if (target && existsSync(target)) after = vscode.Uri.file(target);
    else {
      after = vscode.Uri.parse(`agent-workspace-base:/${randomUUID()}/${path.basename(file)}`);
      this.bases.set(after.toString(), '');
    }
    await vscode.commands.executeCommand(
      'vscode.diff',
      base,
      after,
      `${file} · HEAD ↔ working tree`,
      { viewColumn: this.codeColumn(), preview: true },
    );
  }
  async dispose(): Promise<void> {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    for (const watcher of this.documentWatchers.values()) watcher.dispose();
    // Terminals belong to VS Code; leave their native sessions accessible.
    await this.sessions.dispose();
  }
}
