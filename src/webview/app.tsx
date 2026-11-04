import * as Tooltip from '@radix-ui/react-tooltip';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Attachment,
  agentKind,
  agentLabel,
  type ChangesResult,
  parseMention,
  type Session,
  type Snapshot,
} from '../model';
import {
  api,
  COMPOSE_DRAFT,
  type ComposeChoice,
  emptyCatalog,
  emptySnapshot,
  type HostMessage,
  send,
} from './bridge';
import { Composer } from './composer';
import type { ContextResults } from './context-menu';
import { Conversation } from './conversation';
import { type PanelTab, SidePanel } from './documents-panel';
import { AgentMark, Icon } from './icons';
import { ImageBase } from './image-view';
import { Hint, OverflowMenu } from './model-selector';
import { pendingQuestion, QuestionCard } from './question-card';
import { ThreadSidebar } from './sidebar';

function RecentThreads({
  sessions,
  onSelect,
}: {
  sessions: Session[];
  onSelect: (session: Session) => void;
}) {
  const recent = sessions
    .filter((item) => !item.parentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  if (!recent.length) return null;
  return (
    <nav className="recent-threads" aria-label="Recent threads">
      <div className="section-label">Recent</div>
      {recent.map((item) => (
        <button type="button" key={item.id} onClick={() => onSelect(item)}>
          <AgentMark agent={agentKind(item)} size={13} />
          <span>{item.title}</span>
        </button>
      ))}
    </nav>
  );
}
export function App() {
  const saved = useRef(api?.getState());
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [selectedId, setSelectedId] = useState(saved.current?.selectedId);
  const [drafts, setDrafts] = useState<Record<string, string>>(saved.current?.drafts ?? {});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>(
    saved.current?.attachments ?? {},
  );
  const [imageBase, setImageBase] = useState('');
  const [contextResults, setContextResults] = useState<ContextResults>();
  const [choice, setChoice] = useState<ComposeChoice>(saved.current?.compose ?? { agent: 'codex' });
  const scroll = useRef<Record<string, number>>(saved.current?.scroll ?? {});
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [changes, setChanges] = useState<Record<string, ChangesResult>>({});
  const [changesLoading, setChangesLoading] = useState(false);
  /** Starting a thread can take seconds, and snapshots keep arriving during it. */
  const starting = useRef(false);
  const viewState = { selectedId, drafts, attachments, scroll: scroll.current, compose: choice };
  const stateRef = useRef(viewState);
  stateRef.current = viewState;
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === 'snapshot') {
        setSnapshot(message.snapshot);
        if (message.imageBase) setImageBase(message.imageBase);
        if (!starting.current) setSubmitted(false);
        setSelectedId(message.selectedId);
      }
      if (message.type === 'sent') {
        const delivered = (text = '') =>
          text.trim() === message.text.trim() || parseMention(text)?.prompt === message.text;
        setDrafts((current) =>
          delivered(current[message.id]) ? { ...current, [message.id]: '' } : current,
        );
        setAttachments((current) => ({ ...current, [message.id]: [] }));
        starting.current = false;
        setSubmitted(false);
      }
      if (message.type === 'error') {
        setError(message.text);
        starting.current = false;
        setSubmitted(false);
        setChangesLoading(false);
      }
      if (message.type === 'draft')
        setDrafts((current) => ({ ...current, [message.id]: message.text }));
      if (message.type === 'attached')
        setAttachments((current) => ({
          ...current,
          [message.draftKey]: [...(current[message.draftKey] ?? []), message.attachment],
        }));
      if (message.type === 'contextResults') setContextResults(message);
      if (message.type === 'changes') {
        setChanges((current) => ({ ...current, [message.id]: message.result }));
        setChangesLoading(false);
      }
    };
    const persist = () => api?.setState(stateRef.current);
    window.addEventListener('pagehide', persist);
    window.addEventListener('message', listener);
    send({ type: 'ready' });
    return () => {
      window.removeEventListener('message', listener);
      window.removeEventListener('pagehide', persist);
    };
  }, []);
  useEffect(() => {
    api?.setState({ selectedId, drafts, attachments, scroll: scroll.current, compose: choice });
  }, [selectedId, drafts, attachments, choice]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setHistoryOpen(true);
        requestAnimationFrame(() => document.getElementById('thread-search')?.focus());
      }
      if (event.key === 'Escape') setError('');
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const session = snapshot.sessions.find((item) => item.id === selectedId);
  const parent = session?.parentId
    ? snapshot.sessions.find((item) => item.id === session.parentId)
    : undefined;
  const draftKey = session?.id ?? COMPOSE_DRAFT;
  const draft = drafts[draftKey] ?? '';
  const attached = attachments[draftKey] ?? [];
  const attachedField = attached.length ? { attachments: attached } : {};
  const running = session?.status === 'running' || session?.status === 'waiting';
  const catalog = snapshot.catalog ?? emptyCatalog;
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
  function select(item: Session) {
    setHistoryOpen(false);
    setSelectedId(item.id);
    setError('');
    send({ type: 'select', id: item.id });
  }
  function compose(next?: Partial<ComposeChoice>, carry?: string) {
    setHistoryOpen(false);
    setError('');
    setSelectedId(undefined);
    setChoice((current) => ({ ...current, parentId: undefined, worktree: false, ...next }));
    if (carry !== undefined) setDrafts((current) => ({ ...current, [COMPOSE_DRAFT]: carry }));
    send({ type: 'compose' });
  }
  function submit() {
    if (!draft.trim() || !api) return;
    const mention = parseMention(draft);
    setError('');
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
      if (running || submitted) return;
      setSubmitted(true);
      send({ type: 'send', id: session.id, text: draft, ...attachedField });
      return;
    }
    if (submitted) return;
    starting.current = true;
    setSubmitted(true);
    setChoice((current) => ({ ...current, worktree: false, parentId: undefined }));
    send({
      type: 'start',
      agent: mention?.agent ?? choice.agent,
      text: mention?.prompt ?? draft,
      draftKey,
      ...attachedField,
      ...(mention
        ? {}
        : {
            ...(choice.model ? { model: choice.model } : {}),
            ...(choice.effort ? { effort: choice.effort } : {}),
            ...(choice.mode ? { mode: choice.mode } : {}),
          }),
      ...(choice.worktree ? { worktree: true } : {}),
      ...(choice.parentId ? { parentId: choice.parentId } : {}),
    });
  }
  const asking = pendingQuestion(session, snapshot.sessions);
  const linkedTo = choice.parentId
    ? snapshot.sessions.find((item) => item.id === choice.parentId)
    : undefined;
  return (
    <ImageBase.Provider value={imageBase}>
      <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
        <div
          className={`workspace ${panel ? `panel-${panel}` : 'hide-documents'} ${historyOpen ? 'show-history' : ''}`}
        >
          <main className="main">
            <header className="topbar">
              {session ? (
                <div className="thread-heading">
                  <AgentMark agent={agentKind(session)} />
                  {parent ? (
                    <>
                      <button
                        type="button"
                        className="crumb"
                        title={parent.title}
                        onClick={() => select(parent)}
                      >
                        {parent.title}
                      </button>
                      <Icon name="chevron" size={10} />
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="session-name"
                    title="Rename this thread"
                    disabled={session.observed}
                    onClick={() => send({ type: 'rename', id: session.id })}
                  >
                    {session.title}
                  </button>
                  {session.status !== 'idle' && session.status !== 'completed' ? (
                    <span className={`status-pill ${session.status}`}>{session.status}</span>
                  ) : null}
                </div>
              ) : (
                <div className="thread-heading">
                  <span className="crumb-text">{snapshot.project}</span>
                </div>
              )}
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="icon-button history-toggle"
                  aria-label="Toggle session history"
                  title="Threads"
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen((value) => !value)}
                >
                  <Icon name="history" />
                </button>
                <Hint label="Changes">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Toggle changes"
                    aria-expanded={panel === 'changes'}
                    onClick={() => setPanel((value) => (value === 'changes' ? null : 'changes'))}
                  >
                    <Icon name="diff" />
                  </button>
                </Hint>
                <OverflowMenu
                  items={[
                    ...(session && !session.observed
                      ? [
                          {
                            key: 'terminal',
                            label: 'Open in native terminal',
                            icon: <Icon name="terminal" size={14} />,
                            onSelect: () => send({ type: 'terminal', id: session.id }),
                          },
                          {
                            key: 'handoff',
                            label: 'Hand off to another agent',
                            icon: <Icon name="swap" size={14} />,
                            onSelect: () => send({ type: 'handoff', id: session.id }),
                          },
                        ]
                      : []),
                    {
                      key: 'docs',
                      label: 'Documents',
                      icon: <Icon name="file" size={14} />,
                      onSelect: () => setPanel('docs'),
                    },
                  ]}
                />
                <Hint label="New thread">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="New thread"
                    disabled={!snapshot.trusted}
                    onClick={() => compose()}
                  >
                    <Icon name="plus" />
                  </button>
                </Hint>
              </div>
            </header>
            {!snapshot.trusted ? (
              <div className="trust-banner">
                Trust this folder in VS Code to start local agents and view project documents.
              </div>
            ) : null}
            {!api ? (
              <div className="preview-banner">
                Design preview · agent execution is available inside VS Code
              </div>
            ) : null}
            {error ? (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button type="button" aria-label="Dismiss error" onClick={() => setError('')}>
                  <Icon name="close" />
                </button>
              </div>
            ) : null}
            {session ? (
              <Conversation
                session={session}
                sessions={snapshot.sessions}
                scroll={scroll.current}
                onScroll={(id, top) => {
                  scroll.current[id] = top;
                }}
                onOpenThread={select}
                onUseResult={(text) =>
                  setDrafts((current) => ({
                    ...current,
                    [session.id]: `${text}${current[session.id] ?? ''}`,
                  }))
                }
                onKeepPlanning={() =>
                  document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
                }
              />
            ) : null}
            {asking ? (
              <QuestionCard
                key={asking.approval.id}
                approval={asking.approval}
                sessionId={asking.sessionId}
                from={asking.from}
              />
            ) : null}
            {session?.observed ? (
              <div className="worker-footer">
                <Icon name="branch" />
                {agentLabel(session)} manages this worker from its lead thread.
                {parent ? (
                  <button type="button" onClick={() => select(parent)}>
                    Open lead thread →
                  </button>
                ) : null}
              </div>
            ) : (
              <Composer
                catalog={catalog}
                session={session}
                sessions={snapshot.sessions}
                project={snapshot.project}
                choice={choice}
                draft={draft}
                attachments={attached}
                draftKey={draftKey}
                top={!session}
                contextResults={contextResults}
                onAttachments={(next) =>
                  setAttachments((current) => ({ ...current, [draftKey]: next }))
                }
                onError={setError}
                busy={Boolean(running || (session && submitted))}
                trusted={snapshot.trusted}
                focusKey={draftKey}
                onDraft={(text) => setDrafts((current) => ({ ...current, [draftKey]: text }))}
                onChoice={(next, carry) => {
                  if (carry) {
                    compose(next, draft);
                    setDrafts((current) => ({ ...current, [draftKey]: '' }));
                  } else setChoice(next);
                }}
                onSubmit={submit}
              />
            )}
            {!session ? (
              <div className="compose-home">
                {linkedTo ? (
                  <p className="compose-linked">
                    Linked to <strong>{linkedTo.title}</strong>
                  </p>
                ) : null}
                <RecentThreads sessions={snapshot.sessions} onSelect={select} />
              </div>
            ) : null}
          </main>
          {panel ? (
            <SidePanel
              snapshot={snapshot}
              session={session}
              tab={panel}
              onTab={setPanel}
              onClose={() => setPanel(null)}
              changes={session ? changes[session.id] : undefined}
              changesLoading={changesLoading}
              onRefreshChanges={requestChanges}
              onLinkThread={() => {
                if (session) compose({ agent: agentKind(session), parentId: session.id });
              }}
            />
          ) : null}
          <ThreadSidebar snapshot={snapshot} selectedId={session?.id} onSelect={select} />
        </div>
      </Tooltip.Provider>
    </ImageBase.Provider>
  );
}
