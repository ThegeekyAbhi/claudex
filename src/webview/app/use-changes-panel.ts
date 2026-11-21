import { useState } from 'react';
import type { Session } from '../../shared/model';
import type { PanelTab } from '../features/changes/documents-panel';
import { api, send } from './bridge';

/**
 * The Docs side panel, and the Changes action. Changes open in VS Code's own multi-file diff
 * editor, in the main window, so the webview keeps no list of its own.
 */
export function useChangesPanel(session: Session | undefined) {
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const sessionId = session?.id ?? '';
  return {
    panel,
    setPanel,
    review: () => {
      if (api) send({ type: 'reviewChanges', id: sessionId });
    },
  };
}
