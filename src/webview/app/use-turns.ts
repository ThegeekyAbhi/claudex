import { useRef, useState } from 'react';
import {
  type AgentKind,
  type Attachment,
  agentKind,
  continuationLinks,
  newChatMode,
  parseMention,
  type Session,
  type Snapshot,
} from '../../shared/model';
import { api, send } from './bridge';
import type { useComposeChoice } from './use-compose-choice';
import type { useDrafts } from './use-drafts';
import type { useTabs } from './use-tabs';

export function useTurns(
  snapshot: Snapshot,
  tabs: ReturnType<typeof useTabs>,
  drafts: ReturnType<typeof useDrafts>,
  composeChoice: ReturnType<typeof useComposeChoice>,
  reportError: (text: string) => void,
) {
  const [submitted, setSubmitted] = useState(false);
  /** Starting a thread can take seconds, and snapshots keep arriving during it. */
  const starting = useRef(false);
  const { session, draftKey } = tabs.current;
  const draft = drafts.texts[draftKey] ?? '';
  const attached = drafts.attachments[draftKey] ?? [];
  const attachedField = attached.length ? { attachments: attached } : {};
  const running = session?.status === 'running' || session?.status === 'waiting';
  /**
   * Moves your draft to another agent with this thread's history as a chip you can open or
   * remove. Going back to an agent that already has a linked thread resumes that thread, and it
   * receives only what happened since. Nothing is sent until you press Enter.
   */
  function continueIn(source: Session, next: { agent: AgentKind; model?: string }) {
    const text = drafts.texts[source.id] ?? '';
    drafts.setTexts((current) => ({ ...current, [source.id]: '' }));
    const history = snapshot.preferences.crossAgentContext;
    // Another agent's model and effort mean nothing here: start from that agent's own default.
    const fresh = { agent: next.agent, model: next.model, effort: undefined, thinking: undefined };
    if (history === 'off') {
      tabs.compose(fresh, text);
      return;
    }
    const chip: Attachment = { kind: 'thread', id: source.id, title: source.title, history };
    const linked = continuationLinks(source, snapshot.sessions).find(
      (item) => agentKind(item) === next.agent,
    );
    if (!linked) {
      tabs.compose(fresh, text, [chip]);
      return;
    }
    const withChip = (current: Attachment[] = []) => [
      ...current.filter((item) => !(item.kind === 'thread' && item.id === source.id)),
      chip,
    ];
    drafts.setTexts((current) => ({
      ...current,
      [linked.id]: [current[linked.id], text].filter((part) => part?.trim()).join('\n\n'),
    }));
    drafts.setAttachments((current) => ({ ...current, [linked.id]: withChip(current[linked.id]) }));
    if (next.model && next.model !== linked.model)
      send({ type: 'setModel', id: linked.id, model: next.model, effort: null });
    tabs.select(linked);
  }
  function submit() {
    if (!draft.trim() || !api) return;
    const mention = parseMention(draft);
    reportError('');
    if (session) {
      if (session.observed) return;
      if (mention) {
        send({
          type: 'delegate',
          id: session.id,
          agent: mention.agent,
          text: mention.prompt,
          draftKey,
          ...attachedField,
        });
        return;
      }
      if (session.approval?.kind === 'plan') {
        send({ type: 'keepPlanning', id: session.id, feedback: draft });
        drafts.setTexts((current) => ({ ...current, [session.id]: '' }));
        return;
      }
      if (running || submitted) return;
      setSubmitted(true);
      send({ type: 'send', id: session.id, text: draft, ...attachedField });
      return;
    }
    if (submitted) return;
    starting.current = true;
    tabs.starting(draftKey);
    setSubmitted(true);
    composeChoice.setChoice((current) => ({ ...current, worktree: false, parentId: undefined }));
    // The chip is what links a new thread to the one it continues: remove it and nothing is linked.
    const continuing = attached.find((item) => item.kind === 'thread' && item.history);
    send({
      type: 'start',
      agent: composeChoice.choice.agent,
      text: mention?.prompt ?? draft,
      ...(mention ? { delegate: mention.agent } : {}),
      draftKey,
      ...attachedField,
      mode: newChatMode(composeChoice.choice.modes?.[composeChoice.choice.agent]),
      ...(composeChoice.choice.model ? { model: composeChoice.choice.model } : {}),
      ...(composeChoice.choice.effort ? { effort: composeChoice.choice.effort } : {}),
      ...(composeChoice.choice.thinking ? { thinking: composeChoice.choice.thinking } : {}),
      ...(composeChoice.choice.worktree ? { worktree: true } : {}),
      ...(composeChoice.choice.parentId ? { parentId: composeChoice.choice.parentId } : {}),
      ...(continuing?.kind === 'thread' ? { continuedFrom: continuing.id } : {}),
    });
  }

  function receivedSnapshot() {
    if (!starting.current) setSubmitted(false);
  }
  function sent() {
    starting.current = false;
    setSubmitted(false);
  }
  function failed() {
    starting.current = false;
    tabs.starting(undefined);
    setSubmitted(false);
  }
  return { running, submitted, submit, continueIn, snapshot: receivedSnapshot, sent, failed };
}
