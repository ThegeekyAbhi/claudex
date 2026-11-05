import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
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
  type BuildChoice,
  CAPABILITIES,
  type Catalog,
  deriveTitle,
  emptySkills,
  type ModelOption,
  type Provider,
  type Session,
  type SessionInput,
  type Skill,
  type SkillCatalogs,
  type Snapshot,
  type SnapshotUpdate,
  sameSkill,
  sessionsForView,
  type Thinking,
  tailStart,
  thinkingSupport,
} from '../core/model';
import { listClaudeModels, listCodexModels } from '../harness/model-catalog';
import { createAgentFactory, Sessions } from '../harness/session-manager';
import { listClaudeSkills, listCodexSkills, setCodexSkillEnabled } from '../harness/skill-catalog';
import { ImageStore, MAX_ATTACHED_IMAGE } from '../providers/shared/image-store';
import { resolveInside } from '../providers/shared/paths';
import { resolveAttachments } from './attachments';
import { collectChanges } from './changes';
import {
  createDocument,
  type DocumentKind,
  listDocuments,
  readDocument,
  savePlan,
} from './documents';
import { launcherFor } from './launcher';
import { PlanStore } from './plans';
import {
  CHAT_VIEW,
  FALLBACK_VIEW,
  type Surface,
  Surfaces,
  supportsSecondarySidebar,
} from './surfaces';
import { TerminalCapture } from './terminal-capture';
import { WorkspaceSearch } from './workspace-search';
import { createWorktree, git } from './worktrees';

export class WorkspaceController {
  private sessions: Sessions;
  private images: ImageStore;
  private surfaces: Surfaces;
  private search = new WorkspaceSearch();
  private terminalCapture = new TerminalCapture((text) => this.output.appendLine(text));
  private pendingDrafts = new Map<string, string>();
  private catalog: Catalog = {
    codex: { status: 'loading', models: [] },
    claude: { status: 'loading', models: [] },
    claud2: { status: 'loading', models: [] },
  };
  private catalogLoad?: Promise<void>;
  private skills: SkillCatalogs = structuredClone(emptySkills);
  private skillsVersion = 0;
  private skillLoads = new Map<AgentKind, { at: number; done: Promise<void> }>();
  private selectedId?: string;
  private updateTimer?: NodeJS.Timeout;
  private publishVersion = 0;
  private catalogVersion = 0;
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
  private terminals = new Map<string, vscode.Terminal>();
  private bases = new Map<string, string>();
  private plans: PlanStore;
  private subscriptions: vscode.Disposable[] = [];
  private output = vscode.window.createOutputChannel('Agent Workspace');
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
        this.skills[agentKind(session)].skills.filter((skill) => skill.enabled),
      ),
      undefined,
      this.plans,
      () =>
        vscode.workspace.getConfiguration('agentWorkspace').get<boolean>('guidedPlanning', true),
    );
  }
  async initialize(): Promise<void> {
    await this.sessions.load();
    this.selectedId = this.context.workspaceState.get<string>('selectedId');
    this.sessions.on('change', (full?: boolean) => {
      // Delayed observations can be inserted before the normal streaming tail.
      if (full) this.lastSent = new WeakMap();
      this.scheduleUpdate();
    });
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
  private loadCatalog(force = false): Promise<void> {
    if (this.catalogLoad && !force) return this.catalogLoad;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    const list = (agent: AgentKind): Promise<ModelOption[]> => {
      const target = agentTarget(agent);
      const launcher = launcherFor(target.provider, target.command);
      return target.provider === 'codex'
        ? listCodexModels(launcher.executable, cwd)
        : listClaudeModels(launcher.executable, cwd, launcher.env);
    };
    this.catalogLoad = Promise.all(
      AGENT_KINDS.map(async (agent) => {
        this.catalog[agent] = { status: 'loading', models: this.catalog[agent].models };
        this.catalogVersion++;
        try {
          this.catalog[agent] = { status: 'ready', models: await list(agent) };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          this.output.appendLine(`Models for ${AGENT_LABELS[agent]}: ${text}`);
          this.catalog[agent] = { status: 'error', models: [], error: text };
        }
        this.catalogVersion++;
        this.scheduleUpdate();
      }),
    ).then(() => undefined);
    return this.catalogLoad;
  }
  /** Runs in the background, and at most every 30 s, so opening a menu never waits on a CLI. */
  private loadSkills(agent: AgentKind, force = false): Promise<void> {
    const recent = this.skillLoads.get(agent);
    if (recent && !force && Date.now() - recent.at < 30_000) return recent.done;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    const target = agentTarget(agent);
    const launcher = launcherFor(target.provider, target.command);
    const previous = this.skills[agent];
    this.skills[agent] = { ...previous, status: previous.skills.length ? 'ready' : 'loading' };
    this.skillsVersion++;
    const done = (
      target.provider === 'codex'
        ? listCodexSkills(launcher.executable, cwd, force)
        : listClaudeSkills(launcher.executable, cwd, launcher.env)
    )
      .then((list) => {
        this.skills[agent] = { status: 'ready', ...list };
      })
      .catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`Skills for ${AGENT_LABELS[agent]}: ${text}`);
        this.skills[agent] = { status: 'error', skills: [], problems: [], error: text };
      })
      .then(() => {
        this.skillsVersion++;
        this.scheduleUpdate();
      });
    this.skillLoads.set(agent, { at: Date.now(), done });
    this.scheduleUpdate();
    return done;
  }
  /** Skills come back from the webview, so each is checked against what the CLI really listed. */
  private async checkSkills(
    agent: AgentKind,
    attachments: Attachment[] = [],
  ): Promise<Attachment[]> {
    if (!attachments.some((item) => item.kind === 'skill')) return attachments;
    if (this.skills[agent].status !== 'ready') await this.loadSkills(agent);
    for (const item of attachments) {
      if (item.kind !== 'skill') continue;
      if (!this.skills[agent].skills.some((skill) => skill.enabled && sameSkill(skill, item)))
        throw new Error(`The skill “${item.name}” isn’t available for ${AGENT_LABELS[agent]}.`);
    }
    return attachments;
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
        ...(streaming && last.catalog === this.catalogVersion ? {} : { catalog: this.catalog }),
        ...(streaming && last.skills === this.skillsVersion ? {} : { skills: this.skills }),
        ...(streaming && last.documents === documents ? {} : { documents: documents ?? [] }),
      };
      this.lastSent.set(surface, {
        selectedId,
        status: session?.status,
        messages: session?.messages.length ?? 0,
        surfaces: this.surfaces.size,
        catalog: this.catalogVersion,
        skills: this.skillsVersion,
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
    if (id) this.sessions.get(id);
    if (surface) surface.selectedId = id;
    this.selectedId = id;
    await this.context.workspaceState.update('selectedId', id);
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
      await this.action(actionSchema.parse(raw), surface);
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
  private async input(attachments: Attachment[] | undefined, root: string): Promise<SessionInput> {
    if (!attachments?.length) return {};
    return resolveAttachments(attachments, {
      root,
      store: this.images,
      sessions: this.sessions.sessions,
      terminal: (name) => this.terminalCapture.text(name),
    });
  }
  private async searchContext(
    action: Extract<Action, { type: 'searchContext' }>,
    surface: Surface,
  ): Promise<void> {
    const root = this.documentRoot();
    await surface.webview.postMessage({
      type: 'contextResults',
      requestId: action.requestId,
      matches: root ? await this.search.search(root, action.query) : [],
      recent: root ? this.search.recent(root) : [],
      terminals: this.terminalCapture.names(),
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
    const models = this.catalog[agent].models;
    return model
      ? models.find((item) => item.id === model || item.resolvedModel === model)
      : models.find((item) => item.isDefault);
  }
  private setThinking(session: Session, thinking: Thinking): void {
    if (session.observed || session.transition || ['running', 'waiting'].includes(session.status))
      throw new Error('Wait for this turn or stop it before changing thinking.');
    const model = this.modelOption(agentKind(session), session.model ?? session.activeModel);
    const support = thinkingSupport(session.provider, model);
    if ((thinking === 'on' && !support.on) || (thinking === 'off' && !support.off))
      throw new Error(support.reason || 'This thinking setting is unavailable.');
    session.thinking = thinking;
    session.adaptiveThinking = model?.adaptiveThinking === false ? false : undefined;
    if (
      session.provider === 'codex' &&
      thinking === 'on' &&
      (!session.effort || session.effort === 'none')
    )
      session.effort =
        model?.defaultEffort && model.defaultEffort !== 'none'
          ? model.defaultEffort
          : model?.efforts.find((effort) => effort !== 'none');
    this.sessions.changed();
  }
  /** Unsaved edits in an open editor count, since Build reads the file. */
  private knownSkill(agent: AgentKind, name: string, file: string): Skill {
    const skill = this.skills[agent].skills.find(
      (item) => item.name === name && item.path === file,
    );
    if (!skill) throw new Error(`The skill “${name}” isn’t in ${AGENT_LABELS[agent]}’s list.`);
    return skill;
  }
  private async flushPlanEdits(id: string): Promise<void> {
    const file = this.sessions.get(id).plan?.file;
    const open = vscode.workspace.textDocuments.find((item) => item.fileName === file);
    if (open?.isDirty) await open.save();
  }
  private async buildPlan(id: string, choice: BuildChoice, surface: Surface): Promise<void> {
    await this.flushPlanEdits(id);
    if (choice.agent) {
      const text = await this.sessions.handOffPlan(id);
      await this.startThread(
        {
          type: 'start',
          agent: choice.agent,
          model: choice.model,
          effort: choice.effort,
          mode: choice.mode ?? 'agent',
          text,
          draftKey: '',
          parentId: id,
        },
        surface,
      );
      return;
    }
    if (this.terminals.has(id))
      throw new Error('Close this session’s native terminal before resuming rich chat.');
    await this.sessions.buildPlan(id, choice.mode);
  }
  private async savePlanToWorkspace(id: string): Promise<void> {
    await this.flushPlanEdits(id);
    const session = this.sessions.get(id);
    const text = await this.sessions.currentPlanText(session);
    const relative = await savePlan(session.cwd, session.title, text);
    this.cachedDocuments.delete(session.cwd);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(session.cwd, relative)), {
      viewColumn: this.surfaces.codeColumn(),
    });
    await this.publish();
  }
  private async startThread(
    action: Extract<Action, { type: 'start' }>,
    surface: Surface,
  ): Promise<void> {
    const parent = action.parentId ? this.sessions.get(action.parentId) : undefined;
    const workspace = await this.chooseWorkspace(parent);
    // Checked first, so a bad attachment keeps your draft and creates no thread.
    const input = await this.input(
      await this.checkSkills(action.agent, action.attachments),
      workspace,
    );
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
    if (action.thinking) this.setThinking(session, action.thinking);
    if (action.mode) this.sessions.setMode(session.id, action.mode);
    void surface.webview.postMessage({ type: 'sent', id: action.draftKey, text: action.text });
    // The turn starts first: nothing here is worth keeping the agent waiting for.
    void this.sessions
      .send(session.id, action.text, input)
      .catch((error) => this.output.appendLine(String(error)));
    await this.select(session.id, surface);
    await this.publish(true);
  }
  /** A typed @mention is the user's own instruction, so it starts directly with no approval. */
  private async delegateFromUser(
    action: Extract<Action, { type: 'delegate' }>,
    surface: Surface,
  ): Promise<void> {
    const parent = this.sessions.get(action.id);
    if (parent.observed) throw new Error('This worker is controlled by its main agent.');
    const input = await this.input(
      await this.checkSkills(action.agent, action.attachments),
      parent.workspace,
    );
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
    void surface.webview.postMessage({ type: 'sent', id: action.draftKey, text: action.text });
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
        ready
          .filter((surface) => surface.selectedId === id)
          .map((surface) => surface.webview.postMessage({ type: 'draft', id, text })),
      );
      if (delivered.some(Boolean)) this.pendingDrafts.delete(id);
    }
  }
  private async action(action: Action, surface: Surface): Promise<void> {
    if (action.type === 'ready') {
      surface.ready = true;
      await this.publish(true);
      await this.deliverDrafts();
      if (vscode.workspace.isTrusted) void this.loadCatalog();
      return;
    }
    if (action.type === 'openChat') {
      if (action.id) this.sessions.get(action.id);
      this.surfaces.openInEditor(action.id);
      return;
    }
    if (action.type === 'select') {
      await this.select(action.id, surface);
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
          viewColumn: this.surfaces.codeColumn(),
          selection: new vscode.Range(line, 0, line, 0),
        });
        break;
      }
      case 'compose':
        // Stays on the surface you pressed it in.
        await this.select(undefined, surface);
        await this.publish();
        break;
      case 'start':
        await this.startThread(action, surface);
        break;
      case 'delegate':
        await this.delegateFromUser(action, surface);
        break;
      case 'setModel': {
        const session = this.sessions.get(action.id);
        if (session.transition || ['running', 'waiting'].includes(session.status))
          throw new Error('Stop this turn before changing model or effort.');
        const option = this.modelOption(agentKind(session), action.model);
        if (action.effort && !option?.efforts.includes(action.effort))
          throw new Error('This model does not support that reasoning effort.');
        this.sessions.setModel(action.id, action.model, action.effort, option?.adaptiveThinking);
        const support = thinkingSupport(session.provider, option);
        if (
          (session.thinking === 'off' && !support.off) ||
          (session.thinking === 'on' && !support.on)
        ) {
          session.thinking = 'default';
          session.messages.push({
            id: randomUUID(),
            role: 'notice',
            text: 'Thinking reset to Default because the new model does not support the previous choice.',
          });
        } else if (session.thinking) this.setThinking(session, session.thinking);
        break;
      }
      case 'setThinking':
        this.setThinking(this.sessions.get(action.id), action.thinking);
        break;
      case 'resumeInAuto':
        if (this.terminals.has(action.id))
          throw new Error('Close the native terminal before resuming rich chat.');
        await this.sessions.resumeInAuto(action.id, action.requestId);
        break;
      case 'refreshModels':
        void this.loadCatalog(true);
        break;
      case 'send': {
        const target = this.sessions.get(action.id);
        if (target.observed || ['running', 'waiting'].includes(target.status))
          throw new Error('This session cannot accept a message right now.');
        if (this.terminals.has(action.id))
          throw new Error('Close this session’s native terminal before resuming rich chat.');
        if (target.thinking && target.thinking !== 'default')
          this.setThinking(target, target.thinking);
        const input = await this.input(
          await this.checkSkills(agentKind(target), action.attachments),
          target.workspace,
        );
        void this.sessions
          .send(action.id, action.text, input)
          .catch((error) => this.output.appendLine(String(error)));
        void surface.webview.postMessage({ type: 'sent', id: action.id, text: action.text });
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
      case 'pin': {
        this.sessions.get(action.id).pinned = action.pinned;
        this.sessions.changed();
        break;
      }
      case 'deleteThread': {
        const session = this.sessions.get(action.id);
        const answer = await vscode.window.showWarningMessage(
          `Delete “${session.title}”? Child threads will be kept as independent threads.`,
          { modal: true },
          'Delete',
        );
        if (answer === 'Delete') {
          this.sessions.remove(action.id);
          for (const open of this.surfaces) {
            if (open.selectedId === action.id) await this.select(undefined, open);
          }
        }
        break;
      }
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
            this.surfaces.hasPanel ? 'markdown.showPreviewToSide' : 'markdown.showPreview',
            uri,
          );
        else await vscode.window.showTextDocument(uri, { viewColumn: this.surfaces.codeColumn() });
        break;
      }
      case 'template':
        await this.newDocument(action.kind, action.id);
        break;
      case 'handoff':
        await this.handoff(action.id, surface);
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
        await this.continueInWorktree(action.id, surface);
        break;
      case 'setMode':
        this.sessions.setMode(action.id, action.mode);
        break;
      case 'buildPlan':
        await this.buildPlan(action.id, action, surface);
        break;
      case 'keepPlanning':
        this.sessions.keepPlanning(action.id, action.feedback);
        break;
      case 'refreshSkills':
        void this.loadSkills(action.agent);
        break;
      case 'openSkill': {
        const skill = this.knownSkill(action.agent, action.name, action.path);
        if (skill.path)
          await vscode.window.showTextDocument(vscode.Uri.file(skill.path), {
            viewColumn: this.surfaces.codeColumn(),
          });
        break;
      }
      case 'setSkillEnabled': {
        const skill = this.knownSkill(action.agent, action.name, action.path);
        const target = agentTarget(action.agent);
        if (!CAPABILITIES[target.provider].skillToggle || !skill.path)
          throw new Error(`${AGENT_LABELS[action.agent]} can’t turn skills on or off from here.`);
        await setCodexSkillEnabled(
          launcherFor(target.provider, target.command).executable,
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
          skill.path,
          action.enabled,
        );
        await this.loadSkills(action.agent, true);
        break;
      }
      case 'viewPlan': {
        const file = this.sessions.get(action.id).plan?.file;
        if (!file) throw new Error('This plan has no saved file.');
        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
        break;
      }
      case 'savePlan':
        await this.savePlanToWorkspace(action.id);
        break;
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
        else await vscode.commands.executeCommand('vscode.open', uri, this.surfaces.codeColumn());
        break;
      }
    }
  }
  private async continueInWorktree(id: string, surface: Surface): Promise<void> {
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
    await this.select(session.id, surface);
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
      viewColumn: this.surfaces.codeColumn(),
    });
    await this.publish();
    return relative;
  }
  private async handoff(id: string, surface: Surface): Promise<void> {
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
    await this.select(next.id, surface);
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
    const launcher = launcherFor(session.provider, session.claudeCommand);
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
      { viewColumn: this.surfaces.codeColumn(), preview: true },
    );
  }
  async dispose(): Promise<void> {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    for (const watcher of this.documentWatchers.values()) watcher.dispose();
    // Terminals belong to VS Code; leave their native sessions accessible.
    await this.sessions.dispose();
  }
}
