import { useCallback, useEffect, useRef } from 'react';
import { api, type ViewState } from './bridge';

export function useInitialViewState() {
  return useRef(api?.getState()).current;
}

export function useSavedViewState(state: ViewState) {
  const latest = useRef(state);
  latest.current = state;
  // A block body on purpose: VS Code's setState returns the state, and this runs as an effect,
  // where any returned value is taken as the clean-up function.
  const persist = useCallback(() => {
    api?.setState(latest.current);
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', persist);
    return () => window.removeEventListener('pagehide', persist);
  }, [persist]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: saved fields trigger writes; scroll stays mutable
  useEffect(persist, [
    state.selectedId,
    state.accountsActive,
    state.drafts,
    state.attachments,
    state.compose,
    state.dismissedNudges,
    state.threadView,
    state.tabs,
    state.activeDraft,
    state.seen,
    state.layouts,
    state.threadsFolded,
    state.buildApprovals,
    persist,
  ]);
}
