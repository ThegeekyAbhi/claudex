import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import type { ClaudeCommand, Provider } from '../core/model';
import type { Launcher } from '../harness/session-manager';

function findExecutable(command: string): string | undefined {
  for (const folder of (process.env.PATH ?? '')
    .split(path.delimiter)
    .concat([path.join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'])) {
    const candidate = path.join(folder, command);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
/** Shell aliases are invisible here, so a second account is launched by its config folder. */
export function launcherFor(provider: Provider, claudeCommand?: ClaudeCommand): Launcher {
  const settings = vscode.workspace.getConfiguration('agentWorkspace');
  const command = provider === 'claude' ? (claudeCommand ?? 'claude') : provider;
  const configured = settings.get<string>(`${command}Path`, command);
  if (configured !== command) return { executable: configured };
  if (command !== 'claud2') return { executable: findExecutable(command) ?? configured };
  const wrapper = findExecutable('claud2') ?? findExecutable('claude2');
  if (wrapper) return { executable: wrapper };
  const folder = settings
    .get<string>('claud2ConfigDir', '~/.claude-account2')
    .replace(/^~(?=$|\/)/, homedir());
  if (folder && existsSync(folder))
    return {
      executable: launcherFor('claude', 'claude').executable,
      env: { CLAUDE_CONFIG_DIR: folder },
    };
  return { executable: configured };
}
