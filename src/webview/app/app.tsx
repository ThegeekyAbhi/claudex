import { useCallback, useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  type AgentKind,
  type AgentMode,
  type Attachment,
  agentKind,
  agentLabel,
  type ChangesResult,
  emptySkills,
  mergeSnapshot,
  parseMention,
  type Session,
  type Snapshot,
} from '../../core/model';
import { AgentMark, Icon } from '../components/icons';
import { Hint, OverflowMenu } from '../components/menus';
import type { ContextResults } from '../features/attachments/context-menu';
import { type PanelTab, SidePanel } from '../features/changes/documents-panel';
import { Composer } from '../features/composer/composer';
import { Conversation } from '../features/conversation/conversation';
import { ImageBase } from '../features/images/image-view';
import { BuildContext } from '../features/plan/build-button';
import { pendingQuestion, QuestionCard } from '../features/questions/question-card';
import { SkillsPanel } from '../features/skills/skills-panel';
import { ThreadSidebar } from '../features/threads/thread-list';
import {
  api,
  COMPOSE_DRAFT,
  type ComposeChoice,
  emptyCatalog,
  emptySnapshot,
  type HostMessage,
  send,
} from './bridge';

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
    <nav
      className="max-w-[780px] m-auto [&_button]:w-full [&_button]:justify-start [&_button]:min-h-7 [&_button]:px-2 [&_button]:py-1 [&_button]:text-[12.5px] [&_button]:text-left [&_button>span]:min-w-0 [&_button>span]:truncate"
      aria-label="Recent threads"
    >
      <div className="block text-[11px] font-[450] text-faint mx-2 mb-[3px] truncate">Recent</div>
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
  const [dismissedNudges, setDismissedNudges] = useState<string[]>(
    saved.current?.dismissedNudges ?? [],
  );
  const scroll = useRef<Record<string, number>>(saved.current?.scroll ?? {});
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [changes, setChanges] = useState<Record<string, ChangesResult>>({});
  const [changesLoading, setChangesLoading] = useState(false);
  /** Starting a thread can take seconds, and snapshots keep arriving during it. */
  const starting = useRef(false);
  const viewState = {
    selectedId,
    drafts,
    attachments,
    scroll: scroll.current,
    compose: choice,
    dismissedNudges,
  };
  const stateRef = useRef(viewState);
  stateRef.current = viewState;
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === 'snapshot') {
        setSnapshot((current) => {
          const merged = mergeSnapshot(current, message.snapshot, message.tail);
          // A tail with nothing to attach it to: ask for everything again.
          if (!merged) send({ type: 'ready' });
          return merged ?? current;
        });
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
    api?.setState({
      selectedId,
      drafts,
      attachments,
      scroll: scroll.current,
      compose: choice,
      dismissedNudges,
    });
  }, [selectedId, drafts, attachments, choice, dismissedNudges]);
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
  const [skillsOpen, setSkillsOpen] = useState(false);
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
  function rememberMode(agent: AgentKind, mode: AgentMode) {
    setChoice((current) => ({ ...current, modes: { ...current.modes, [agent]: mode } }));
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
      if (session.approval?.kind === 'plan') {
        send({ type: 'keepPlanning', id: session.id, feedback: draft });
        setDrafts((current) => ({ ...current, [session.id]: '' }));
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
            ...(choice.thinking ? { thinking: choice.thinking } : {}),
            ...(choice.modes?.[choice.agent] ? { mode: choice.modes[choice.agent] } : {}),
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
    <BuildContext.Provider
      value={{ catalog: snapshot.catalog ?? emptyCatalog, sessions: snapshot.sessions }}
    >
      <ImageBase.Provider value={imageBase}>
        <TooltipProvider delayDuration={350} skipDelayDuration={200}>
          <div
            className={`workspace grid grid-cols-[minmax(0,1fr)_280px_232px] h-dvh overflow-hidden border-l border-strong [&.hide-documents]:grid-cols-[minmax(0,1fr)_232px] [&.panel-changes]:grid-cols-[minmax(320px,1fr)_minmax(320px,42%)_232px] max-[900px]:grid-cols-[minmax(0,1fr)] max-[900px]:[&.hide-documents]:grid-cols-[minmax(0,1fr)] max-[900px]:[&.panel-changes]:grid-cols-[minmax(0,1fr)] [[data-surface=view]_&]:border-l-0 ${panel ? `panel-${panel}` : 'hide-documents'} ${historyOpen ? 'show-history' : ''}`}
          >
            <main className="main min-w-0 min-h-0 flex flex-col relative">
              <header className="h-10 shrink-0 border-b border-subtle flex items-center gap-2 pr-2 pl-4">
                {session ? (
                  <div className="flex-1 min-w-0 flex items-center gap-1.5 text-muted-foreground max-[480px]:[&>.chevron]:hidden">
                    <AgentMark agent={agentKind(session)} />
                    {parent ? (
                      <>
                        <button
                          type="button"
                          className="px-1 py-[3px] text-[12px] text-muted-foreground max-w-[30%] block truncate shrink max-[480px]:hidden"
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
                      className="session-name min-w-0 px-1 py-[3px] text-foreground text-[13px] font-medium block truncate disabled:opacity-100"
                      title="Rename this thread"
                      disabled={session.observed}
                      onClick={() => send({ type: 'rename', id: session.id })}
                    >
                      {session.title}
                    </button>
                    {session.status !== 'idle' && session.status !== 'completed' ? (
                      <span
                        className={`text-[10px] py-px text-muted-foreground shrink-0 [&.running]:text-foreground [&.waiting]:text-warning [&.failed]:text-error max-[480px]:hidden ${session.status}`}
                      >
                        {session.status}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 flex items-center gap-1.5 text-muted-foreground max-[480px]:[&>.chevron]:hidden">
                    <span className="text-[12px]">{snapshot.project}</span>
                  </div>
                )}
                <div className="flex shrink-0">
                  <button
                    type="button"
                    className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0 hidden max-[900px]:inline-flex"
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
                      className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
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
                      {
                        key: 'skills',
                        label: 'Skills',
                        icon: <Icon name="wrench" size={14} />,
                        onSelect: () => setSkillsOpen(true),
                      },
                    ]}
                  />
                  <Hint label="New thread">
                    <button
                      type="button"
                      className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
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
                <div className="text-[12px] px-4 py-2 bg-surface border-b border-subtle wrap-anywhere">
                  Trust this folder in VS Code to start local agents and view project documents.
                </div>
              ) : null}
              {!api ? (
                <div className="text-[12px] px-4 py-2 bg-surface border-b border-subtle wrap-anywhere text-warning">
                  Design preview · agent execution is available inside VS Code
                </div>
              ) : null}
              {error ? (
                <div
                  className="text-[12px] px-4 py-2 bg-surface border-b border-subtle wrap-anywhere flex items-center text-error justify-between gap-2"
                  role="alert"
                >
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
                <div className="flex items-center justify-center gap-2 border-t border-subtle p-3 text-[12px] text-muted-foreground flex-wrap">
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
                  skills={snapshot.skills ?? emptySkills}
                  onManageSkills={() => setSkillsOpen(true)}
                  session={session}
                  sessions={snapshot.sessions}
                  project={snapshot.project}
                  choice={choice}
                  onMode={rememberMode}
                  dismissedNudges={dismissedNudges}
                  onDismissNudge={(key) => setDismissedNudges((current) => [...current, key])}
                  draft={draft}
                  attachments={attached}
                  draftKey={draftKey}
                  top={!session}
                  contextResults={contextResults}
                  onAttachments={(next) =>
                    setAttachments((current) => ({ ...current, [draftKey]: next }))
                  }
                  onError={setError}
                  busy={Boolean(
                    session?.transition ||
                      (running && session?.approval?.kind !== 'plan') ||
                      (session && submitted),
                  )}
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
                <div className="flex-1 min-h-0 overflow-y-auto pt-2 px-6 pb-4 max-[900px]:pt-1 max-[900px]:px-3 max-[900px]:pb-3">
                  {linkedTo ? (
                    <p className="max-w-[780px] mx-auto mb-2 text-[12px] text-muted-foreground">
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
          {skillsOpen ? (
            <SkillsPanel
              catalogs={snapshot.skills ?? emptySkills}
              initialAgent={session ? agentKind(session) : choice.agent}
              onClose={() => setSkillsOpen(false)}
            />
          ) : null}
        </TooltipProvider>
      </ImageBase.Provider>
    </BuildContext.Provider>
  );
}
