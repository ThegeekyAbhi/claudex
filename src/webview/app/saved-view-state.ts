import type { ViewState } from './bridge';
import type { useComposeChoice } from './use-compose-choice';
import type { useDrafts } from './use-drafts';
import type { useTabs } from './use-tabs';
import type { useThreadView } from './use-thread-view';
import type { useWorkspaceLayout } from './use-workspace-layout';

export interface SavedViewSources {
  drafts: Pick<ReturnType<typeof useDrafts>, 'texts' | 'attachments'>;
  compose: Pick<ReturnType<typeof useComposeChoice>, 'choice' | 'dismissedNudges'>;
  tabs: Omit<ReturnType<typeof useTabs>['saved'], 'accountsActive'> & { accountsActive?: boolean };
  threads: Pick<ReturnType<typeof useThreadView>, 'scroll' | 'threadView' | 'seen'>;
  layout?: Pick<ReturnType<typeof useWorkspaceLayout>, 'layouts'> & {
    threads?: { folded: boolean };
  };
}

export function savedViewState({
  drafts,
  compose,
  tabs,
  threads,
  layout,
}: SavedViewSources): ViewState {
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
    ...(layout && Object.keys(layout.layouts).length ? { layouts: layout.layouts } : {}),
    ...(layout?.threads?.folded ? { threadsFolded: true } : {}),
  };
}
