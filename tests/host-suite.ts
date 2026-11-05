import assert from 'node:assert/strict';
import * as vscode from 'vscode';
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('nerdyabhi.claudex');
  assert.ok(extension, 'Development extension should be discovered');
  await extension.activate();
  assert.ok(extension.isActive);
  const commands = await vscode.commands.getCommands();
  assert.ok(commands.includes('agentWorkspace.open'));
  await vscode.commands.executeCommand('agentWorkspace.open');
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  assert.ok(
    tabs.some((tab) => tab.label === 'Claudex'),
    'Claudex webview should open',
  );
  console.log(
    'HOST_CHECK_PASSED: extension activation, command registration, and webview opening.',
  );
}
