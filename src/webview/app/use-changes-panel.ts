import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangesResult, Session } from '../../shared/model';
import type { PanelTab } from '../features/changes/documents-panel';
import { api, send } from './bridge';

export function useChangesPanel(session: Session | undefined) {
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [changes, setChanges] = useState<Record<string, ChangesResult>>({});
  const [changesLoading, setChangesLoading] = useState(false);
  const sessionId = session?.id ?? '';
  const pending = useRef('');
  const status = session?.status;
  const requestChanges = useCallback(() => {
    if (!api) return;
    setChangesLoading(true);
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    send({ type: 'changes', id: sessionId, requestId });
  }, [sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: status is the trigger; a turn ending can change files
  useEffect(() => {
    if (panel === 'changes') requestChanges();
  }, [panel, requestChanges, status]);
  function received(id: string, result: ChangesResult) {
    // Only the newest request for the current thread may replace the list.
    if (id !== sessionId || (result.requestId && result.requestId !== pending.current)) return;
    setChanges((current) => ({ ...current, [id]: result }));
    setChangesLoading(false);
  }
  return {
    panel,
    setPanel,
    result: changes[sessionId],
    loading: changesLoading,
    refresh: requestChanges,
    received,
    failed: () => setChangesLoading(false),
  };
}
