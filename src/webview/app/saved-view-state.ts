import type { ViewState } from './bridge';
import type { useComposeChoice } from './use-compose-choice';
import type { useDrafts } from './use-drafts';
import type { useTabs } from './use-tabs';
import type { useThreadView } from './use-thread-view';

export interface SavedViewSources {
  drafts: Pick<ReturnType<typeof useDrafts>, 'texts' | 'attachments'>;
  compose: Pick<ReturnType<typeof useComposeChoice>, 'choice' | 'dismissedNudges'>;
  tabs: Omit<ReturnType<typeof useTabs>['saved'], 'accountsActive'> & { accountsActive?: boolean };
  threads: Pick<ReturnType<typeof useThreadView>, 'scroll' | 'threadView' | 'seen'>;
}

export function savedViewState({ drafts, compose, tabs, threads }: SavedViewSources): ViewState {
  return {
    selectedId: tabs.selectedId,
    ...(tabs.accountsActive ? { accountsActive: true } : {}),
    drafts: drafts.texts,
    attachments: drafts.attachments,
    scroll: threads.scroll.current,
    compose: compose.choice,
    dismissedNudges: compose.dismissedNudges,
    threadView: threads.threadView,
    tabs: tabs.tabs,
    activeDraft: tabs.activeDraft,
    seen: threads.seen,
  };
}
