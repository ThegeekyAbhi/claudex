import type * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import type { ActionHandlers } from '../router';

export interface ThreadControlContext {
  sessions: Pick<Sessions, 'get' | 'changed' | 'interrupt' | 'approve' | 'allowInAuto' | 'setMode'>;
  terminals: Map<string, { terminal: vscode.Terminal; openedAt: number }>;
}

export function threadControlHandlers(
  context: ThreadControlContext,
): Pick<ActionHandlers, 'interrupt' | 'approve' | 'pin' | 'setMode'> {
  return {
    interrupt: async (action) => {
      if (context.terminals.has(action.id)) {
        context.terminals.get(action.id)?.terminal.show();
        throw new Error('This session is in a native terminal. Use Ctrl+C there to stop it.');
      }
      await context.sessions.interrupt(action.id);
    },
    approve: (action) => {
      if (action.auto && action.allowed) context.sessions.allowInAuto(action.id, action.requestId);
      else context.sessions.approve(action.id, action.requestId, action.allowed, action.answers);
    },
    pin: (action) => {
      context.sessions.get(action.id).pinned = action.pinned;
      context.sessions.changed();
    },
    setMode: (action) => {
      context.sessions.setMode(action.id, action.mode);
    },
  };
}
