import { pendingQuestion } from '../features/questions/question-card';
import { savedViewState } from './saved-view-state';
import { useChangesPanel } from './use-changes-panel';
import { useComposeChoice } from './use-compose-choice';
import { useDrafts } from './use-drafts';
import { useHostMessages } from './use-host-messages';
import { useInitialViewState, useSavedViewState } from './use-saved-view-state';
import { useTabs } from './use-tabs';
import { useThreadView } from './use-thread-view';
import { useTurns } from './use-turns';
import { useWorkspaceEffects, useWorkspaceUI } from './use-workspace-ui';

export function useAppState() {
  const saved = useInitialViewState();
  const drafts = useDrafts(saved);
  const ui = useWorkspaceUI();
  // Callbacks run after render; each concern handles only its own state transitions.
  const host = useHostMessages({
    drafts,
    turns: {
      snapshot: () => turns.snapshot(),
      sent: () => turns.sent(),
      failed: () => turns.failed(),
    },
    tabs: { snapshot: (id) => tabs.snapshot(id) },
    changes: {
      received: (id, result) => changes.received(id, result),
      failed: () => changes.failed(),
    },
    reportError: ui.setError,
  });
  const compose = useComposeChoice(saved, host.snapshot.agents);
  const tabs = useTabs(saved, host.snapshot.sessions, drafts, compose, ui.setError);
  const changes = useChangesPanel(tabs.current.session);
  const threads = useThreadView(
    saved,
    host.snapshot.sessions,
    tabs.accounts.active ? undefined : tabs.current.session,
  );
  const turns = useTurns(host.snapshot, tabs, drafts, compose, ui.setError);
  useSavedViewState(savedViewState({ drafts, compose, tabs: tabs.saved, threads }));
  useWorkspaceEffects(host.snapshot.preferences.appearance, ui.setError, tabs.history.setOpen);
  const conversation = {
    asking: pendingQuestion(tabs.current.session, host.snapshot.sessions),
    linkedTo: compose.choice.parentId
      ? host.snapshot.sessions.find((item) => item.id === compose.choice.parentId)
      : undefined,
  };
  return { host, drafts, compose, tabs, threads, changes, turns, ui, conversation };
}
