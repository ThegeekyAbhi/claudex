import { useCallback, useEffect, useState } from 'react';
import type { ChangesResult, Session } from '../../shared/model';
import type { PanelTab } from '../features/changes/documents-panel';
import { api, send } from './bridge';

export function useChangesPanel(session: Session | undefined) {
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [changes, setChanges] = useState<Record<string, ChangesResult>>({});
  const [changesLoading, setChangesLoading] = useState(false);
  const sessionId = session?.id;
  const status = session?.status;
  const requestChanges = useCallback(() => {
    if (!sessionId || !api) return;
    setChangesLoading(true);
    send({ type: 'changes', id: sessionId });
  }, [sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: status is the trigger; a turn ending can change files
  useEffect(() => {
    if (panel === 'changes') requestChanges();
  }, [panel, requestChanges, status]);
  function received(id: string, result: ChangesResult) {
    setChanges((current) => ({ ...current, [id]: result }));
    setChangesLoading(false);
  }
  return {
    panel,
    setPanel,
    result: session ? changes[session.id] : undefined,
    loading: changesLoading,
    refresh: requestChanges,
    received,
    failed: () => setChangesLoading(false),
  };
}
