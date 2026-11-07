import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import { git } from '../../infrastructure/git';
import { resolveInside } from '../../providers/shared/paths';
import type { AgentKind, AgentProfile, ChangesResult, Provider } from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { collectChanges } from '../changes';
import { createDocument, type DocumentKind, type listDocuments, readDocument } from '../documents';
import type { Surface, Surfaces } from '../surfaces';

export interface DocumentsHandlersContext {
  sessions: Pick<Sessions, 'get' | 'create'>;
  documentRoot(): string | undefined;
  cachedDocuments: Map<string, Awaited<ReturnType<typeof listDocuments>>>;
  surfaces: Pick<Surfaces, 'codeColumn' | 'hasPanel' | 'panelColumns'>;
  publish(full?: boolean): Promise<void>;
  requireAgent(id: AgentKind): AgentProfile;
  select(id?: string, surface?: Surface): Promise<void>;
  pendingDrafts: Map<string, string>;
  deliverDrafts(): Promise<void>;
  /** Read-only "before" content served by the `agent-workspace-base:` scheme. */
  bases: Map<string, string>;
  globalState: vscode.Memento;
}

const CHANGES_TITLE = 'Changes';
const FILE_LIST_OFFERED = 'changes.fileListOffered';
const GROUP_FOCUS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
type ChangesResource = { originalUri?: vscode.Uri; modifiedUri?: vscode.Uri };

export class DocumentsHandlers {
  constructor(private context: DocumentsHandlersContext) {}
  async newDocument(kind: DocumentKind, id?: string): Promise<string | undefined> {
    const session = id ? this.context.sessions.get(id) : undefined;
    const root = session?.cwd ?? this.context.documentRoot();
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
    this.context.cachedDocuments.delete(root);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, relative)), {
      viewColumn: this.context.surfaces.codeColumn(),
    });
    await this.context.publish();
    return relative;
  }
  async handoff(id: string, surface: Surface): Promise<void> {
    const session = this.context.sessions.get(id);
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
    this.context.requireAgent(provider);
    const next = this.context.sessions.create(
      provider,
      session.cwd,
      session.workspace,
      `${session.title} (handoff)`,
    );
    await this.context.select(next.id, surface);
    await this.context.publish();
    this.context.pendingDrafts.set(
      next.id,
      `Continue the work described in this user-reviewed handoff. Source document: ${path.join(session.cwd, relative)}\n\n${document.getText()}`,
    );
    await this.context.deliverDrafts();
  }
  private reviewTab?: vscode.Tab;
  private openSequence = 0;
  /** The last listing per thread; diffs only open files that listing reported. */
  private reviews = new Map<string, { root: string; result: ChangesResult }>();
  private rootFor(id: string): string {
    const root = id ? this.context.sessions.get(id).cwd : this.context.documentRoot();
    if (!root) throw new Error('Open a workspace first.');
    return root;
  }
  private async listChanges(id: string): Promise<ChangesResult> {
    const root = this.rootFor(id);
    const result = await collectChanges(root).catch(
      (error): ChangesResult => ({
        files: [],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    this.reviews.set(id, { root: result.root ?? root, result });
    return result;
  }
  /**
   * Opens every changed file in VS Code's own multi-file diff editor, scrolled to `reveal`.
   * The same listing reuses one tab, so picking files never piles up editors.
   */
  async reviewAll(id: string, reveal?: string): Promise<void> {
    const result = await this.listChanges(id);
    if (result.error) throw new Error(result.error);
    const root = result.root ?? this.rootFor(id);
    const files = result.files.filter((file) => !file.binary);
    if (!files.length) {
      void vscode.window.showInformationMessage(
        result.files.length
          ? 'Only binary files changed; VS Code cannot compare them as text.'
          : 'No uncommitted changes in this checkout.',
      );
      return;
    }
    const baseline = result.baseline;
    const resources: (ChangesResource & { path: string })[] = await Promise.all(
      files.map(async (file) => {
        const modified = vscode.Uri.file(await checkoutPath(root, file.path));
        const before = file.original ? await checkoutPath(root, file.original) : modified.fsPath;
        return {
          path: file.path,
          // The same path as the file, so VS Code labels it Modified rather than Renamed.
          originalUri:
            file.kind === 'add' || !baseline
              ? undefined
              : vscode.Uri.file(before).with({
                  scheme: 'agent-workspace-base',
                  query: `ref=${baseline}`,
                }),
          modifiedUri: file.kind === 'delete' ? undefined : modified,
        };
      }),
    );
    const title = `${CHANGES_TITLE} · ${baseline?.slice(0, 7) ?? 'no commits'} ↔ working tree`;
    // Same files, same tab: content stays live because the right side is the real file.
    const source = vscode.Uri.from({
      scheme: 'multi-diff-editor',
      path: `claudex/${createHash('sha256')
        .update(JSON.stringify([root, baseline, files.map((f) => [f.path, f.kind, f.original])]))
        .digest('hex')
        .slice(0, 16)}`,
    });
    const target = resources.find((resource) => resource.path === reveal)?.modifiedUri;
    await this.focusChangesGroup();
    try {
      // Internal, but it is the only opener that reuses a tab and reveals a file.
      await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
        title,
        multiDiffSourceUri: source,
        resources: resources.map(({ originalUri, modifiedUri }) => ({ originalUri, modifiedUri })),
        ...(target ? { reveal: { modifiedUri: target } } : {}),
      });
    } catch {
      try {
        await vscode.commands.executeCommand(
          'vscode.changes',
          title,
          resources.map((resource) => [
            resource.modifiedUri ?? resource.originalUri,
            resource.originalUri,
            resource.modifiedUri,
          ]),
        );
      } catch {
        const file = files.find((entry) => entry.path === reveal) ?? files[0];
        await this.openDiff(id, file.path, file.original);
        return;
      }
    }
    void this.offerFileList(() => this.reviewAll(id, reveal));
  }
  /** Keeps the editor-tab chat visible: Changes opens in another group, made if needed. */
  private async focusChangesGroup(): Promise<void> {
    const chat = this.context.surfaces.panelColumns();
    if (!chat.length) return;
    const groups = vscode.window.tabGroups.all.filter((group) => !chat.includes(group.viewColumn));
    const target =
      groups.find((group) => group.tabs.some((tab) => tab.label.startsWith(CHANGES_TITLE))) ??
      groups[0];
    const focus = target && GROUP_FOCUS[target.viewColumn - 1];
    if (focus) await vscode.commands.executeCommand(`workbench.action.focus${focus}EditorGroup`);
    else if (!target) await vscode.commands.executeCommand('workbench.action.newGroupRight');
  }
  /** VS Code's file list and card layout are experimental settings; ask once, never assume. */
  private async offerFileList(reopen: () => Promise<void>): Promise<void> {
    const config = vscode.workspace.getConfiguration('multiDiffEditor');
    const setting = config.inspect<boolean>('experimental.fileList');
    if (setting?.defaultValue === undefined || config.get<boolean>('experimental.fileList')) return;
    if (this.context.globalState.get<boolean>(FILE_LIST_OFFERED)) return;
    await this.context.globalState.update(FILE_LIST_OFFERED, true);
    const choice = await vscode.window.showInformationMessage(
      'Show a changed-files list and card layout in the Changes editor? This turns on two experimental VS Code settings (multiDiffEditor.experimental.*).',
      'Turn on',
      'Not now',
    );
    if (choice !== 'Turn on') return;
    await config.update('experimental.fileList', true, vscode.ConfigurationTarget.Global);
    await config.update('experimental.variant', 'cards', vscode.ConfigurationTarget.Global);
    // The settings apply to new editors only.
    const open = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.label.startsWith(CHANGES_TITLE) && !tab.isDirty);
    await vscode.window.tabGroups.close(open, true);
    await reopen();
  }
  async openDiff(id: string, file: string, original?: string): Promise<void> {
    const sequence = ++this.openSequence;
    const review = this.reviews.get(id);
    const root = review?.root ?? this.rootFor(id);
    const entry = review?.result.files.find((entry) => entry.path === file);
    if (review && !entry) throw new Error('This file is no longer in the review. Refresh changes.');
    original = entry?.original ?? original;
    const target = await checkoutPath(root, file);
    if (original) await checkoutPath(root, original);
    const baseline = review?.result.baseline;
    const added = entry?.kind === 'add';
    const before =
      added || (review && !baseline)
        ? ''
        : await git(root, ['show', `${baseline ?? 'HEAD'}:${original ?? file}`]);
    const base = vscode.Uri.parse(`agent-workspace-base:/${randomUUID()}/${path.basename(file)}`);
    this.context.bases.set(base.toString(), before);
    let after: vscode.Uri;
    if (target && existsSync(target)) after = vscode.Uri.file(target);
    else {
      after = vscode.Uri.parse(`agent-workspace-base:/${randomUUID()}/${path.basename(file)}`);
      this.context.bases.set(after.toString(), '');
    }
    if (sequence !== this.openSequence) return;
    const previous = this.reviewTab;
    const group = vscode.window.tabGroups.all.find(
      (group) => previous && group.tabs.includes(previous),
    );
    await vscode.commands.executeCommand(
      'vscode.diff',
      base,
      after,
      `${file} · ${baseline?.slice(0, 7) ?? 'HEAD'} ↔ working tree`,
      { viewColumn: group?.viewColumn ?? this.context.surfaces.codeColumn(), preview: true },
    );
    this.reviewTab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.original.toString() === base.toString(),
      );
    if (
      previous &&
      previous !== this.reviewTab &&
      !previous.isDirty &&
      !previous.isPinned &&
      vscode.window.tabGroups.all.some((group) => group.tabs.includes(previous))
    ) {
      await vscode.window.tabGroups.close(previous, true);
    }
  }
  handlers(): HandlersFor<'documents'> {
    return {
      link: async (action) => {
        if (/^https?:\/\//.test(action.href)) {
          await vscode.env.openExternal(vscode.Uri.parse(action.href));
          return;
        }
        const root = this.context.documentRoot();
        if (!root) throw new Error('Open a workspace first.');
        const match = /^(.*?)(?::(\d+))?$/.exec(decodeURIComponent(action.href));
        if (!match || /^[a-z]+:/i.test(match[1])) throw new Error('Unsupported link.');
        const target = await resolveInside(root, match[1]);
        const line = Math.max(0, Number(match[2] ?? 1) - 1);
        await vscode.window.showTextDocument(vscode.Uri.file(target), {
          viewColumn: this.context.surfaces.codeColumn(),
          selection: new vscode.Range(line, 0, line, 0),
        });
      },
      document: async (action) => {
        const root = this.context.documentRoot();
        if (!root) throw new Error('Open a workspace first.');
        await readDocument(root, action.path);
        const uri = vscode.Uri.file(await resolveInside(root, action.path));
        if (action.preview)
          await vscode.commands.executeCommand(
            this.context.surfaces.hasPanel ? 'markdown.showPreviewToSide' : 'markdown.showPreview',
            uri,
          );
        else
          await vscode.window.showTextDocument(uri, {
            viewColumn: this.context.surfaces.codeColumn(),
          });
      },
      template: async (action) => {
        await this.newDocument(action.kind, action.id);
      },
      handoff: async (action, surface) => {
        await this.handoff(action.id, surface);
      },
      changes: async (action, surface) => {
        const result = { ...(await this.listChanges(action.id)), requestId: action.requestId };
        await surface.webview.postMessage({ type: 'changes', id: action.id, result });
      },
      reviewChanges: async (action) => {
        await this.reviewAll(action.id, action.file);
      },
      openDiff: async (action) => {
        await this.openDiff(action.id, action.file, action.original);
      },
      copy: async (action) => {
        await vscode.env.clipboard.writeText(action.text);
      },
    };
  }
}

/** Resolves a checkout-relative path that must stay inside the checkout, even when deleted. */
async function checkoutPath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error('Expected a checkout-relative path.');
  const lexical = path.resolve(root, relative);
  const rel = path.relative(root, lexical);
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('Path outside checkout.');
  if (existsSync(lexical)) return resolveInside(root, relative);
  // Deleted files still require a contained, existing parent directory.
  let parent = path.dirname(relative);
  while (!existsSync(path.resolve(root, parent))) parent = path.dirname(parent);
  await resolveInside(root, parent);
  return lexical;
}
