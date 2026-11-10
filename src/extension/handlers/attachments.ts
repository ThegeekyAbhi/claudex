import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import { type ImageStore, MAX_ATTACHED_IMAGE } from '../../providers/shared/image-store';
import { type Action, buildPacket } from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import type { Surface, Surfaces } from '../surfaces';
import type { TerminalCapture } from '../terminal-capture';
import type { WorkspaceSearch } from '../workspace-search';

export interface AttachmentsHandlersContext {
  sessions: Pick<Sessions, 'get' | 'sessions'>;
  surfaces: Pick<Surfaces, 'codeColumn'>;
  documentRoot(): string | undefined;
  search: Pick<WorkspaceSearch, 'search' | 'recent'>;
  terminalCapture: Pick<TerminalCapture, 'names'>;
  images: Pick<ImageStore, 'save' | 'path'>;
}

export class AttachmentsHandlers {
  constructor(private context: AttachmentsHandlersContext) {}
  /** Opens exactly what a continue chip will send, as an unsaved Markdown document. */
  async previewContext(action: Extract<Action, { type: 'previewContext' }>): Promise<void> {
    const source = this.context.sessions.get(action.id);
    const target = action.targetId
      ? this.context.sessions.sessions.find((item) => item.id === action.targetId)
      : undefined;
    const packet = buildPacket(source, {
      history: action.history,
      since: target?.synced?.[source.id],
    });
    const content = packet.empty
      ? `Nothing new in “${source.title}” since this thread last received it. The chip will send nothing.\n`
      : `<!-- What the next message will include from “${source.title}”${packet.omitted ? `. ${packet.omitted} older entries were left out to fit the ${action.history} limit` : ''}. Editing this preview changes nothing. -->\n\n${packet.text}\n`;
    const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(document, {
      viewColumn: this.context.surfaces.codeColumn(),
      preview: true,
    });
  }
  async searchContext(
    action: Extract<Action, { type: 'searchContext' }>,
    surface: Surface,
  ): Promise<void> {
    const root = this.context.documentRoot();
    await surface.webview.postMessage({
      type: 'contextResults',
      requestId: action.requestId,
      matches: root ? await this.context.search.search(root, action.query) : [],
      recent: root ? this.context.search.recent(root) : [],
      terminals: this.context.terminalCapture.names(),
    });
  }
  async addImage(
    bytes: Uint8Array,
    name: string,
    draftKey: string,
    surface: Surface,
  ): Promise<void> {
    const file = await this.context.images.save(bytes, MAX_ATTACHED_IMAGE);
    await surface.webview.postMessage({
      type: 'attached',
      draftKey,
      attachment: { kind: 'image', file, name },
    });
  }
  async pickImages(draftKey: string, surface: Surface): Promise<void> {
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
  handlers(): HandlersFor<'attachments'> {
    return {
      previewContext: async (action) => {
        await this.previewContext(action);
      },
      searchContext: async (action, surface) => {
        await this.searchContext(action, surface);
      },
      pickImages: async (action, surface) => {
        await this.pickImages(action.draftKey, surface);
      },
      attachImage: async (action, surface) => {
        await this.addImage(
          Buffer.from(action.data, 'base64'),
          action.name,
          action.draftKey,
          surface,
        );
      },
      openImage: async (action) => {
        const uri = vscode.Uri.file(this.context.images.path(action.file));
        if (action.reveal) await vscode.commands.executeCommand('revealFileInOS', uri);
        else
          await vscode.commands.executeCommand('vscode.open', uri, {
            viewColumn: this.context.surfaces.codeColumn(),
            preview: true,
          });
      },
    };
  }
}
