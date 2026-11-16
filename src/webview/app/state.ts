import { pendingQuestion } from '../features/questions/question-card';
import { useSideQuestions } from '../features/side-question/use-side-questions';
import { savedViewState } from './saved-view-state';
import { useChangesPanel } from './use-changes-panel';
import { useComposeChoice } from './use-compose-choice';
import { useDrafts } from './use-drafts';
import { useHostMessages } from './use-host-messages';
import { useInitialViewState, useSavedViewState } from './use-saved-view-state';
import { useTabs } from './use-tabs';
import { useThreadView } from './use-thread-view';
import { useTurns } from './use-turns';
import { useWorkspaceLayout } from './use-workspace-layout';
import { useWorkspaceEffects, useWorkspaceUI } from './use-workspace-ui';

export function useAppState() {
  const saved = useInitialViewState();
  const ui = useWorkspaceUI();
  const drafts = useDrafts(saved, ui.setError);
  // Callbacks run after render; each concern handles only its own state transitions.
  const host = useHostMessages({
    drafts,
    turns: {
      snapshot: () => turns.snapshot(),
      sent: (id, submissionId) => turns.sent(id, submissionId),
      failed: (submissionId, key) => turns.failed(submissionId, key),
    },
    tabs: { snapshot: (id) => tabs.snapshot(id) },
    changes: {
      received: (id, result) => changes.received(id, result),
      failed: (id, requestId) => changes.failed(id, requestId),
    },
    reportError: ui.setError,
  });
  const compose = useComposeChoice(saved, host.snapshot.agents);
  const tabs = useTabs(saved, host.snapshot.sessions, drafts, compose, ui.setError);
  const changes = useChangesPanel(tabs.current.session);
  const threads = useThreadView(
    saved,
    host.snapshot.sessions,
    tabs.page ? undefined : tabs.current.session,
  );
  const side = useSideQuestions();
  const turns = useTurns(host.snapshot, tabs, drafts, compose, ui.setError, side.ask);
  const layout = useWorkspaceLayout(saved);
  useSavedViewState(savedViewState({ drafts, compose, tabs: tabs.saved, threads, layout }));
  const revealThreads = () => layout.threads.reveal(() => tabs.history.setOpen(true));
  useWorkspaceEffects(host.snapshot.preferences.appearance, ui.setError, revealThreads);
  const conversation = {
    asking: pendingQuestion(tabs.current.session, host.snapshot.sessions),
    linkedTo: compose.choice.parentId
      ? host.snapshot.sessions.find((item) => item.id === compose.choice.parentId)
      : undefined,
  };
  return {
    host,
    drafts,
    compose,
    tabs,
    threads,
    changes,
    turns,
    side,
    ui,
    conversation,
    layout,
    revealThreads,
  };
}
