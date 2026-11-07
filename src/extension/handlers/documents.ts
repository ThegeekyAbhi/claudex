import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import { git } from '../../infrastructure/git';
import { resolveInside } from '../../providers/shared/paths';
import type { AgentKind, AgentProfile, Provider } from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { collectChanges } from '../changes';
import { createDocument, type DocumentKind, type listDocuments, readDocument } from '../documents';
import type { Surface, Surfaces } from '../surfaces';

export interface DocumentsHandlersContext {
  sessions: Pick<Sessions, 'get' | 'create'>;
  documentRoot(): string | undefined;
  cachedDocuments: Map<string, Awaited<ReturnType<typeof listDocuments>>>;
  surfaces: Pick<Surfaces, 'codeColumn' | 'hasPanel'>;
  publish(full?: boolean): Promise<void>;
  requireAgent(id: AgentKind): AgentProfile;
  select(id?: string, surface?: Surface): Promise<void>;
  pendingDrafts: Map<string, string>;
  deliverDrafts(): Promise<void>;
  bases: Map<string, string>;
}

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
  async openDiff(id: string, file: string, original?: string): Promise<void> {
    const session = this.context.sessions.get(id);
    const target = await resolveInside(session.cwd, file).catch(() => undefined);
    const before = await git(session.cwd, ['show', `HEAD:${original ?? file}`]).catch(() => '');
    const base = vscode.Uri.parse(`agent-workspace-base:/${randomUUID()}/${path.basename(file)}`);
    this.context.bases.set(base.toString(), before);
    let after: vscode.Uri;
    if (target && existsSync(target)) after = vscode.Uri.file(target);
    else {
      after = vscode.Uri.parse(`agent-workspace-base:/${randomUUID()}/${path.basename(file)}`);
      this.context.bases.set(after.toString(), '');
    }
    await vscode.commands.executeCommand(
      'vscode.diff',
      base,
      after,
      `${file} · HEAD ↔ working tree`,
      { viewColumn: this.context.surfaces.codeColumn(), preview: true },
    );
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
        const session = this.context.sessions.get(action.id);
        await surface.webview.postMessage({
          type: 'changes',
          id: action.id,
          result: await collectChanges(session.cwd),
        });
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
