import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import { createWorktree } from '../../infrastructure/worktrees';
import type { ImageStore } from '../../providers/shared/image-store';
import {
  type Action,
  type AgentKind,
  type AgentProfile,
  type Attachment,
  agentKind,
  agentTarget,
  deriveTitle,
  type ModelOption,
  type Session,
  type SessionInput,
  type Thinking,
} from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { resolveAttachments } from '../attachments';
import type { Surface } from '../surfaces';
import type { TerminalCapture } from '../terminal-capture';
import { threadControlHandlers } from './thread-control';

export interface ThreadsHandlersContext {
  sessions: Pick<
    Sessions,
    | 'get'
    | 'sessions'
    | 'create'
    | 'setModel'
    | 'setMode'
    | 'send'
    | 'changed'
    | 'delegate'
    | 'remove'
    | 'setTitle'
    | 'interrupt'
    | 'approve'
    | 'allowInAuto'
  >;
  images: ImageStore;
  terminalCapture: Pick<TerminalCapture, 'text'>;
  selected(): Session | undefined;
  requireAgent(id: AgentKind): AgentProfile;
  checkSkills(agent: AgentKind, attachments?: Attachment[]): Promise<Attachment[]>;
  modelOption(agent: AgentKind, model?: string | null): ModelOption | undefined;
  setThinking(session: Session, thinking: Thinking): void;
  select(id?: string, surface?: Surface): Promise<void>;
  publish(full?: boolean): Promise<void>;
  output: Pick<vscode.OutputChannel, 'appendLine'>;
  pendingDrafts: Map<string, string>;
  deliverDrafts(): Promise<void>;
  terminals: Map<string, { terminal: vscode.Terminal; openedAt: number }>;
  surfaces: Iterable<Surface>;
}

export class ThreadsHandlers {
  constructor(private context: ThreadsHandlersContext) {}
  async input(
    attachments: Attachment[] | undefined,
    root: string,
    receiver?: { cwd: string; synced?: Record<string, string> },
  ): Promise<SessionInput> {
    if (!attachments?.length) return {};
    for (const attachment of attachments) {
      if (attachment.kind !== 'thread' || !attachment.history) continue;
      const source = this.context.sessions.get(attachment.id);
      // Two agents editing one checkout at once would trip over each other.
      if (
        ['running', 'waiting'].includes(source.status) &&
        (!receiver || receiver.cwd === source.cwd)
      )
        throw new Error(
          `“${source.title}” is still working. Wait for it or stop it, then continue here.`,
        );
    }
    return resolveAttachments(attachments, {
      root,
      store: this.context.images,
      sessions: this.context.sessions.sessions,
      terminal: (name) => this.context.terminalCapture.text(name),
      synced: receiver?.synced,
    });
  }
  async chooseWorkspace(parent?: Session): Promise<string> {
    if (parent) return parent.workspace;
    const folders = vscode.workspace.workspaceFolders?.filter(
      (folder) => folder.uri.scheme === 'file',
    );
    if (!folders?.length) throw new Error('Open a local project folder first.');
    if (folders.length === 1) return folders[0].uri.fsPath;
    const current = this.context.selected()?.workspace;
    if (current && folders.some((folder) => folder.uri.fsPath === current)) return current;
    const editor = vscode.window.activeTextEditor?.document.uri;
    const active = editor && vscode.workspace.getWorkspaceFolder(editor);
    if (active) return active.uri.fsPath;
    const picked = await vscode.window.showWorkspaceFolderPick();
    if (!picked) throw new Error('Choose a project folder to start this thread.');
    return picked.uri.fsPath;
  }
  async startThread(action: Extract<Action, { type: 'start' }>, surface: Surface): Promise<void> {
    this.context.requireAgent(action.agent);
    // Check the mentioned agent before anything is created, so a missing CLI leaves no thread behind.
    if (action.delegate) this.context.requireAgent(action.delegate);
    const parent = action.parentId ? this.context.sessions.get(action.parentId) : undefined;
    const continued = action.continuedFrom
      ? this.context.sessions.get(action.continuedFrom)
      : undefined;
    if (continued?.observed)
      throw new Error('A worker can only be continued from its lead thread.');
    const workspace = continued?.workspace ?? (await this.chooseWorkspace(parent));
    // Checked first, so a bad attachment keeps your draft and creates no thread.
    const input = await this.input(
      await this.context.checkSkills(action.delegate ?? action.agent, action.attachments),
      workspace,
      // A new worktree is a separate checkout, so the source may keep working.
      action.worktree ? { cwd: '' } : undefined,
    );
    const cwd = action.worktree
      ? await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Creating agent worktree' },
          () => createWorktree(workspace),
        )
      : (continued?.cwd ?? parent?.cwd ?? workspace);
    const target = agentTarget(action.agent);
    const session = this.context.sessions.create(
      target.provider,
      cwd,
      workspace,
      deriveTitle(action.text),
      parent?.id,
      target.profileId,
    );
    if (continued) session.continuedFrom = continued.id;
    this.context.sessions.setModel(
      session.id,
      action.model ?? null,
      action.effort ?? null,
      this.context.modelOption(action.agent, action.model)?.adaptiveThinking,
    );
    if (action.thinking) this.context.setThinking(session, action.thinking);
    if (action.mode) this.context.sessions.setMode(session.id, action.mode);
    // The mentioned agent runs in a card. Your main agent starts when you next message it.
    if (action.delegate) {
      await this.delegateFromUser(
        {
          type: 'delegate',
          id: session.id,
          agent: action.delegate,
          text: action.text,
          draftKey: action.draftKey,
          attachments: action.attachments,
        },
        surface,
      );
      await this.context.select(session.id, surface);
      await this.context.publish(true);
      return;
    }
    void surface.webview.postMessage({ type: 'sent', id: action.draftKey, text: action.text });
    // The turn starts first: nothing here is worth keeping the agent waiting for.
    void this.context.sessions
      .send(session.id, action.text, input)
      .catch((error) => this.context.output.appendLine(String(error)));
    await this.context.select(session.id, surface);
    await this.context.publish(true);
  }
  /** A typed @mention is the user's own instruction, so it starts directly with no approval. */
  async delegateFromUser(
    action: Extract<Action, { type: 'delegate' }>,
    surface: Surface,
  ): Promise<void> {
    const parent = this.context.sessions.get(action.id);
    if (parent.observed) throw new Error('This worker is controlled by its main agent.');
    if (this.context.terminals.has(parent.id))
      throw new Error(
        'This thread is open in the terminal. Close it there to start another agent.',
      );
    this.context.requireAgent(action.agent);
    const input = await this.input(
      await this.context.checkSkills(action.agent, action.attachments),
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
      this.context.sessions.changed();
    };
    this.context.sessions.changed();
    void surface.webview.postMessage({ type: 'sent', id: action.draftKey, text: action.text });
    void this.context.sessions
      .delegate(
        parent.id,
        { agent: action.agent, prompt: action.text },
        (sessionId) => patch({ workerId: sessionId }),
        input,
      )
      .then(
        (result) => patch({ status: result.status === 'completed' ? 'completed' : 'failed' }),
        (error) => {
          this.context.output.appendLine(String(error));
          patch({ status: 'failed' });
        },
      );
  }
  async continueInWorktree(id: string, surface: Surface): Promise<void> {
    const source = this.context.sessions.get(id);
    const cwd = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating agent worktree' },
      () => createWorktree(source.workspace),
    );
    const session = this.context.sessions.create(
      source.provider,
      cwd,
      source.workspace,
      `${source.title} (worktree)`,
      source.id,
      source.profileId,
    );
    this.context.sessions.setModel(session.id, source.model ?? null, source.effort ?? null);
    await this.context.select(session.id, surface);
    await this.context.publish();
    this.context.pendingDrafts.set(
      session.id,
      `Continue the task from the thread “${source.title}”. This worktree starts from committed HEAD, so uncommitted changes from that checkout are not here.`,
    );
    await this.context.deliverDrafts();
  }
  handlers(): HandlersFor<'threads'> {
    return {
      ...threadControlHandlers(this.context),
      compose: async (_action, surface) => {
        await this.context.select(undefined, surface);
        await this.context.publish();
      },
      start: async (action, surface) => {
        await this.startThread(action, surface);
      },
      delegate: async (action, surface) => {
        await this.delegateFromUser(action, surface);
      },
      send: async (action, surface) => {
        const target = this.context.sessions.get(action.id);
        if (target.observed || ['running', 'waiting'].includes(target.status))
          throw new Error('This session cannot accept a message right now.');
        if (this.context.terminals.has(action.id))
          throw new Error('Close this session’s native terminal before resuming rich chat.');
        this.context.requireAgent(agentKind(target));
        if (target.thinking && target.thinking !== 'default')
          this.context.setThinking(target, target.thinking);
        const input = await this.input(
          await this.context.checkSkills(agentKind(target), action.attachments),
          target.workspace,
          target,
        );
        void this.context.sessions
          .send(action.id, action.text, input)
          .catch((error) => this.context.output.appendLine(String(error)));
        void surface.webview.postMessage({ type: 'sent', id: action.id, text: action.text });
      },
      deleteThread: async (action) => {
        const session = this.context.sessions.get(action.id);
        const answer = await vscode.window.showWarningMessage(
          `Delete “${session.title}”? Child threads will be kept as independent threads.`,
          { modal: true },
          'Delete',
        );
        if (answer === 'Delete') {
          this.context.sessions.remove(action.id);
          for (const open of this.context.surfaces) {
            if (open.selectedId === action.id) await this.context.select(undefined, open);
          }
        }
      },
      rename: async (action) => {
        const session = this.context.sessions.get(action.id);
        const title = await vscode.window.showInputBox({
          title: 'Rename session',
          value: session.title,
        });
        if (title?.trim()) this.context.sessions.setTitle(action.id, title.trim());
      },
      worktree: async (action, surface) => {
        await this.continueInWorktree(action.id, surface);
      },
    };
  }
}
