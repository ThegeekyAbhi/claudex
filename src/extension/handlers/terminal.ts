import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import { terminalArgs } from '../../providers/terminal';
import { agentLabel } from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { launcherFor } from '../launcher';
import type { NativeHistory } from '../native-history';
import type { Surface } from '../surfaces';

export interface TerminalHandlersContext {
  sessions: Pick<Sessions, 'get' | 'interrupt' | 'disconnect' | 'changed' | 'resumeInAuto'>;
  terminals: Map<string, { terminal: vscode.Terminal; openedAt: number }>;
  output: Pick<vscode.OutputChannel, 'appendLine'>;
  extension: Pick<vscode.ExtensionContext, 'extensionPath'>;
  history: Pick<NativeHistory, 'sync' | 'refresh' | 'open'>;
  select(id?: string, surface?: Surface): Promise<void>;
  publish(full?: boolean): Promise<void>;
}

export class TerminalHandlers {
  constructor(private context: TerminalHandlersContext) {}
  async terminal(id: string): Promise<void> {
    const session = this.context.sessions.get(id);
    if (session.observed) throw new Error('Open the lead agent’s terminal to manage this worker.');
    if (!session.nativeId)
      throw new Error(
        'Send a first message in rich chat before resuming this thread in the native terminal.',
      );
    const existing = this.context.terminals.get(id);
    if (existing) {
      existing.terminal.show();
      return;
    }
    if (session.status === 'running' || session.status === 'waiting') {
      const choice = await vscode.window.showWarningMessage(
        'Stop this turn and continue in the native CLI?',
        { modal: true },
        'Stop and open terminal',
      );
      if (!choice) return;
      await this.context.sessions.interrupt(id);
    }
    await this.context.sessions.disconnect(id);
    const { args, note } = terminalArgs(session);
    const launcher = launcherFor(session.provider, session.profileId);
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
      text: `Opened in the ${agentLabel(session)} terminal.${note ? ` ${note}` : ''}`,
    });
    this.context.terminals.set(id, { terminal, openedAt: Date.now() });
    session.inTerminal = true;
    session.status = 'idle';
    this.context.sessions.changed();
    terminal.show();
  }
  async terminalBack(id: string): Promise<void> {
    const active = this.context.terminals.get(id);
    if (!active) return;
    const choice = await vscode.window.showWarningMessage(
      'Close this terminal and go back to chat? Anything still running in it stops.',
      { modal: true },
      'Close terminal',
    );
    if (choice) active.terminal.dispose();
  }
  /** Adds what happened in the terminal. The CLI keeps it either way, so a failed read loses nothing. */
  async returnFromTerminal(id: string): Promise<void> {
    const session = this.context.sessions.get(id);
    session.inTerminal = false;
    this.context.sessions.changed();
    const notice = (text: string) =>
      session.messages.push({ id: randomUUID(), role: 'notice', text });
    try {
      const outcome = await this.context.history.sync(id, { force: true, announce: true });
      if (outcome && !outcome.added && !outcome.updated)
        notice('Back from the terminal. No new messages.');
    } catch (error) {
      this.context.output.appendLine(String(error));
      notice(
        'Couldn’t read the terminal messages. The CLI still has them, and they’ll carry on when you next send.',
      );
    }
    session.updatedAt = Date.now();
    this.context.sessions.changed(true);
  }
  handlers(): HandlersFor<'terminal'> {
    return {
      terminal: async (action) => {
        await this.terminal(action.id);
      },
      terminalBack: async (action) => {
        await this.terminalBack(action.id);
      },
      refreshNativeSessions: async () => {
        await this.context.history.refresh({ force: true });
      },
      openNativeSession: async (action, surface) => {
        const session = await this.context.history.open(action.agent, action.sessionId);
        await this.context.select(session.id, surface);
        await this.context.publish(true);
      },
      resumeInAuto: async (action) => {
        if (this.context.terminals.has(action.id))
          throw new Error('Close the native terminal before resuming rich chat.');
        await this.context.sessions.resumeInAuto(action.id, action.requestId);
      },
    };
  }
}
