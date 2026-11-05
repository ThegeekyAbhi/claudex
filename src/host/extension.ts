import * as vscode from 'vscode';
import { WorkspaceController } from './controller';

let controller: WorkspaceController | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  controller = new WorkspaceController(context);
  try {
    await controller.initialize();
  } catch (error) {
    await vscode.window.showErrorMessage(`Claudex could not initialize: ${String(error)}`);
    throw error;
  }
}
export async function deactivate(): Promise<void> {
  await controller?.dispose();
}
