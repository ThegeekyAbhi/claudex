import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { parseAppearance } from '../core/preferences';

/** The secondary side bar accepts extension views from this version on. */
const SECONDARY_SIDEBAR = { major: 1, minor: 106 };
export function supportsSecondarySidebar(): boolean {
  const [major, minor] = vscode.version.split('.').map(Number);
  return (
    major > SECONDARY_SIDEBAR.major ||
    (major === SECONDARY_SIDEBAR.major && minor >= SECONDARY_SIDEBAR.minor)
  );
}
export const CHAT_VIEW = 'agentWorkspace.chat';
export const FALLBACK_VIEW = 'agentWorkspace.chatFallback';
/** One open copy of the UI: the side bar view, or the large layout in an editor tab. */
export interface Surface {
  kind: 'view' | 'panel';
  webview: vscode.Webview;
  ready: boolean;
  selectedId?: string;
  panel?: vscode.WebviewPanel;
}
export class Surfaces {
  private all = new Set<Surface>();
  private panels = new Map<vscode.WebviewPanel, Surface>();
  active?: Surface;
  constructor(
    private extensionUri: vscode.Uri,
    private imageFolder: string,
    private onMessage: (raw: unknown, surface: Surface) => void,
  ) {}
  get size(): number {
    return this.all.size;
  }
  [Symbol.iterator](): IterableIterator<Surface> {
    return this.all[Symbol.iterator]();
  }
  post(message: unknown): void {
    for (const surface of this.all) void surface.webview.postMessage(message);
  }
  async reveal(): Promise<void> {
    if (this.active?.panel) this.active.panel.reveal();
    else
      await vscode.commands.executeCommand(
        `${supportsSecondarySidebar() ? CHAT_VIEW : FALLBACK_VIEW}.focus`,
      );
  }
  /** Beside the editor-tab layout if it is open; otherwise in the center, where the code is. */
  codeColumn(): vscode.ViewColumn {
    return this.panels.size ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  }
  get hasPanel(): boolean {
    return Boolean(this.panels.size);
  }
  attach(webview: vscode.Webview, kind: Surface['kind']): Surface {
    const surface: Surface = { kind, webview, ready: false };
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.file(this.imageFolder),
      ],
    };
    webview.html = webviewHtml(webview, this.extensionUri, kind);
    this.all.add(surface);
    webview.onDidReceiveMessage((raw) => this.onMessage(raw, surface));
    return surface;
  }
  remove(surface: Surface): void {
    this.all.delete(surface);
  }
  openInEditor(id?: string): void {
    if (id) {
      for (const [panel, surface] of this.panels) {
        if (surface.selectedId === id) {
          panel.reveal();
          this.active = surface;
          return;
        }
      }
    }
    const panel = vscode.window.createWebviewPanel(
      'agentWorkspace',
      'New chat',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media/mascot/icon.png');
    const surface = this.attach(panel.webview, 'panel');
    surface.selectedId = id;
    surface.panel = panel;
    this.panels.set(panel, surface);
    this.active = surface;
    panel.onDidChangeViewState(() => {
      if (panel.active) this.active = surface;
    });
    panel.onDidDispose(() => {
      this.remove(surface);
      this.panels.delete(panel);
      if (this.active === surface) this.active = undefined;
    });
  }
}
/** The one page every webview loads. `data-surface` tells it which UI to start. */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  kind: Surface['kind'] | 'plan',
): string {
  const nonce = randomUUID();
  const asset = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name));
  const fonts = asset('webview.css');
  const style = asset('app.css');
  const script = asset('webview.js');
  return `<!doctype html><html lang="en" data-surface="${kind}" data-appearance="${parseAppearance(vscode.workspace.getConfiguration('agentWorkspace').get('appearance'))}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"><link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="${style}"><title>Claudex</title></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`;
}
