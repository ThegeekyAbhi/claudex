import { useCallback, useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AGENT_KINDS,
  AGENT_LABELS,
  type AgentKind,
  type AgentMode,
  type Attachment,
  agentKind,
  agentLabel,
  type ChangesResult,
  continuationLinks,
  emptySkills,
  mergeSnapshot,
  newChatMode,
  parseMention,
  type Session,
  type Snapshot,
  threadTitle,
} from '../../core/model';
import { AgentMark, Icon } from '../components/icons';
import { Hint, OverflowMenu } from '../components/menus';
import type { ContextResults } from '../features/attachments/context-menu';
import { type PanelTab, SidePanel } from '../features/changes/documents-panel';
import { Composer } from '../features/composer/composer';
import { TerminalStrip } from '../features/composer/terminal-strip';
import { Conversation } from '../features/conversation/conversation';
import { ImageBase } from '../features/images/image-view';
import { BuildContext } from '../features/plan/build-button';
import { pendingQuestion, QuestionCard } from '../features/questions/question-card';
import { SkillsPanel } from '../features/skills/skills-panel';
import {
  DRAFT_TAB,
  isDraftTab,
  pruneSeen,
  reconcileTabs,
  type SeenAt,
  tabAfterClosing,
  threadSignal,
} from '../features/threads/tab-state';
import type { ThreadViewState } from '../features/threads/thread-filter';
import { ThreadSidebar } from '../features/threads/thread-list';
import { type TabItem, ThreadTabs } from '../features/threads/thread-tabs';
import {
  api,
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
          <span>{threadTitle(item.title)}</span>
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
  const [threadView, setThreadView] = useState<ThreadViewState>(saved.current?.threadView ?? {});
  const [tabs, setTabs] = useState<string[]>(saved.current?.tabs ?? []);
  const [activeDraft, setActiveDraft] = useState(saved.current?.activeDraft ?? DRAFT_TAB);
  const [seen, setSeen] = useState<SeenAt>(saved.current?.seen ?? {});
  const [visible, setVisible] = useState(!document.hidden);
  const scroll = useRef<Record<string, number>>(saved.current?.scroll ?? {});
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [changes, setChanges] = useState<Record<string, ChangesResult>>({});
  const [changesLoading, setChangesLoading] = useState(false);
  /** Starting a thread can take seconds, and snapshots keep arriving during it. */
  const starting = useRef(false);
  /** Tabs just closed, until the host confirms it has moved on from them. */
  const closing = useRef(new Set<string>());
  /** The draft whose first message is on its way, so its thread can take over its tab. */
  const startedDraft = useRef<string | undefined>(undefined);
  const draftCount = useRef(0);
  const viewState = {
    selectedId,
    drafts,
    attachments,
    scroll: scroll.current,
    compose: choice,
    dismissedNudges,
    threadView,
    tabs,
    activeDraft,
    seen,
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
        // A snapshot sent before you closed a tab must not reopen it.
        if (!message.selectedId || !closing.current.has(message.selectedId)) {
          closing.current.clear();
          setSelectedId(message.selectedId);
        }
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
        startedDraft.current = undefined;
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
      threadView,
      tabs,
      activeDraft,
      seen,
    });
  }, [
    selectedId,
    drafts,
    attachments,
    choice,
    dismissedNudges,
    threadView,
    tabs,
    activeDraft,
    seen,
  ]);
  useEffect(() => {
    document.documentElement.dataset.appearance = snapshot.preferences.appearance;
  }, [snapshot.preferences.appearance]);
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
  const draftKey = session?.id ?? activeDraft;
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
    closing.current.delete(item.id);
    setHistoryOpen(false);
    setSelectedId(item.id);
    setError('');
    send({ type: 'select', id: item.id });
  }
  const known = new Set(snapshot.sessions.map((item) => item.id));
  const activeKey = session?.id ?? activeDraft;
  const openKeys = reconcileTabs(
    tabs,
    activeKey,
    known,
    session ? startedDraft.current : undefined,
  );
  const tabItems = openKeys.flatMap((key): TabItem[] => {
    if (isDraftTab(key)) return [{ kind: 'draft', key, text: drafts[key] ?? '' }];
    const item = snapshot.sessions.find((other) => other.id === key);
    return item ? [{ kind: 'thread', key, session: item }] : [];
  });
  const threadChildren = new Map<string, Session[]>();
  for (const item of snapshot.sessions)
    if (item.parentId)
      threadChildren.set(item.parentId, [...(threadChildren.get(item.parentId) ?? []), item]);
  const openList = openKeys.join('\n');
  // Sessions are empty until the first snapshot, which must not read as every tab being closed.
  const loaded = snapshot.sessions.length > 0;
  useEffect(() => {
    if (loaded || session) setTabs(openList ? openList.split('\n') : []);
    if (session) startedDraft.current = undefined;
  }, [openList, loaded, session]);
  const seenId = session?.id;
  const seenAt = session?.updatedAt;
  const seenRunning = session?.status === 'running';
  // While a thread streams, its first look is enough: leaving it mid-turn must still count later.
  useEffect(() => {
    if (!seenId || seenAt === undefined || !visible) return;
    setSeen((current) =>
      seenRunning && current[seenId] !== undefined ? current : { ...current, [seenId]: seenAt },
    );
  }, [seenId, seenAt, seenRunning, visible]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only needed when threads come or go
  useEffect(() => {
    if (loaded) setSeen((current) => pruneSeen(current, known));
  }, [loaded, snapshot.sessions.length]);
  useEffect(() => {
    const listener = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  function activate(item: TabItem) {
    if (item.kind === 'thread') select(item.session);
    else openDraft(item.key);
  }
  function openDraft(key: string) {
    setHistoryOpen(false);
    setError('');
    setSelectedId(undefined);
    setActiveDraft(key);
    send({ type: 'compose' });
  }
  function closeTab(item: TabItem) {
    const rest = openKeys.filter((key) => key !== item.key);
    setTabs(rest);
    if (item.kind === 'draft') {
      setDrafts(({ [item.key]: _closed, ...current }) => current);
      setAttachments(({ [item.key]: _closed, ...current }) => current);
    }
    if (item.key !== activeKey) return;
    if (item.kind === 'thread') closing.current.add(item.key);
    const next = tabItems.find((tab) => tab.key === tabAfterClosing(openKeys, item.key));
    if (next) activate(next);
    else compose();
  }
  function rememberMode(agent: AgentKind, mode: AgentMode) {
    setChoice((current) => ({ ...current, modes: { ...current.modes, [agent]: mode } }));
  }
  /** Always a new tab: whatever you've typed elsewhere stays in its own tab, sent or not. */
  function compose(next?: Partial<ComposeChoice>, carry?: string, attach?: Attachment[]) {
    const key = `${DRAFT_TAB}:${Date.now()}-${++draftCount.current}`;
    setTabs([...openKeys, key]);
    setChoice((current) => ({ ...current, parentId: undefined, worktree: false, ...next }));
    if (carry !== undefined) setDrafts((current) => ({ ...current, [key]: carry }));
    if (attach?.length) setAttachments((current) => ({ ...current, [key]: attach }));
    openDraft(key);
  }
  /**
   * Moves your draft to another agent with this thread's history as a chip you can open or
   * remove. Going back to an agent that already has a linked thread resumes that thread, and it
   * receives only what happened since. Nothing is sent until you press Enter.
   */
  function continueIn(source: Session, next: { agent: AgentKind; model?: string }) {
    const text = drafts[source.id] ?? '';
    setDrafts((current) => ({ ...current, [source.id]: '' }));
    const history = snapshot.preferences.crossAgentContext;
    // Another agent's model and effort mean nothing here: start from that agent's own default.
    const fresh = { agent: next.agent, model: next.model, effort: undefined, thinking: undefined };
    if (history === 'off') {
      compose(fresh, text);
      return;
    }
    const chip: Attachment = { kind: 'thread', id: source.id, title: source.title, history };
    const linked = continuationLinks(source, snapshot.sessions).find(
      (item) => agentKind(item) === next.agent,
    );
    if (!linked) {
      compose(fresh, text, [chip]);
      return;
    }
    const withChip = (current: Attachment[] = []) => [
      ...current.filter((item) => !(item.kind === 'thread' && item.id === source.id)),
      chip,
    ];
    setDrafts((current) => ({
      ...current,
      [linked.id]: [current[linked.id], text].filter((part) => part?.trim()).join('\n\n'),
    }));
    setAttachments((current) => ({ ...current, [linked.id]: withChip(current[linked.id]) }));
    if (next.model && next.model !== linked.model)
      send({ type: 'setModel', id: linked.id, model: next.model, effort: null });
    select(linked);
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
    startedDraft.current = draftKey;
    setSubmitted(true);
    setChoice((current) => ({ ...current, worktree: false, parentId: undefined }));
    // The chip is what links a new thread to the one it continues: remove it and nothing is linked.
    const continuing = attached.find((item) => item.kind === 'thread' && item.history);
    send({
      type: 'start',
      agent: choice.agent,
      text: mention?.prompt ?? draft,
      ...(mention ? { delegate: mention.agent } : {}),
      draftKey,
      ...attachedField,
      mode: newChatMode(choice.modes?.[choice.agent]),
      ...(choice.model ? { model: choice.model } : {}),
      ...(choice.effort ? { effort: choice.effort } : {}),
      ...(choice.thinking ? { thinking: choice.thinking } : {}),
      ...(choice.worktree ? { worktree: true } : {}),
      ...(choice.parentId ? { parentId: choice.parentId } : {}),
      ...(continuing?.kind === 'thread' ? { continuedFrom: continuing.id } : {}),
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
              <header className="h-10 shrink-0 bg-chrome flex items-center">
                <ThreadTabs
                  items={tabItems}
                  activeKey={activeKey}
                  signalOf={(item) => threadSignal(item, threadChildren, seen)}
                  onActivate={activate}
                  onClose={closeTab}
                  onRename={(item) => send({ type: 'rename', id: item.id })}
                />
                <div className="flex shrink-0 items-center h-full pl-1 pr-2 border-b border-l border-subtle">
                  <Hint label="New chat">
                    <button
                      type="button"
                      className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
                      aria-label="New chat"
                      disabled={!snapshot.trusted}
                      onClick={() => compose()}
                    >
                      <Icon name="plus" />
                    </button>
                  </Hint>
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
                  {session && !session.observed ? (
                    <Hint
                      label={
                        session.inTerminal
                          ? 'Show terminal'
                          : session.nativeId
                            ? `Open in the ${agentLabel(session)} terminal`
                            : `Send ${agentLabel(session)} a message first, then this thread can open in its terminal`
                      }
                    >
                      <span className="inline-flex">
                        <button
                          type="button"
                          className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-pressed:text-foreground disabled:pointer-events-none disabled:opacity-50"
                          aria-label="Open in terminal"
                          aria-pressed={Boolean(session.inTerminal)}
                          disabled={!session.nativeId}
                          onClick={() => send({ type: 'terminal', id: session.id })}
                        >
                          <Icon name="terminal" />
                        </button>
                      </span>
                    </Hint>
                  ) : null}
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
                            ...(snapshot.preferences.crossAgentContext !== 'off'
                              ? AGENT_KINDS.filter((kind) => kind !== agentKind(session)).map(
                                  (kind) => ({
                                    key: `continue-${kind}`,
                                    label: `Continue in ${AGENT_LABELS[kind]}`,
                                    icon: <Icon name="swap" size={14} />,
                                    onSelect: () => continueIn(session, { agent: kind }),
                                  }),
                                )
                              : []),
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
                      {
                        key: 'appearance',
                        label:
                          snapshot.preferences.appearance === 'cursor'
                            ? 'Use editor theme colors'
                            : 'Use Cursor dark colors',
                        icon: <Icon name="palette" size={14} />,
                        onSelect: () =>
                          send({
                            type: 'setAppearance',
                            appearance:
                              snapshot.preferences.appearance === 'cursor' ? 'editor' : 'cursor',
                          }),
                      },
                    ]}
                  />
                </div>
              </header>
              {parent ? (
                <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-subtle text-[11.5px] text-muted-foreground">
                  <span>Subagent of</span>
                  <button
                    type="button"
                    className="min-w-0 px-1 py-px text-muted-foreground block truncate"
                    title={parent.title}
                    onClick={() => select(parent)}
                  >
                    {threadTitle(parent.title)}
                  </button>
                </div>
              ) : null}
              {session && !parent && continuationLinks(session, snapshot.sessions).length ? (
                <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-subtle text-[11.5px] text-muted-foreground min-w-0 overflow-hidden">
                  <Icon name="swap" size={12} />
                  {continuationLinks(session, snapshot.sessions).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="min-w-0 px-1 py-px text-muted-foreground block truncate"
                      title={item.title}
                      onClick={() => select(item)}
                    >
                      {item.id === session.continuedFrom ? 'Continued from' : 'Continued in'}{' '}
                      {agentLabel(item)}: {threadTitle(item.title)}
                    </button>
                  ))}
                </div>
              ) : null}
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
              ) : session?.inTerminal ? (
                <TerminalStrip id={session.id} label={agentLabel(session)} />
              ) : (
                <Composer
                  preferences={snapshot.preferences}
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
                    if (carry && session?.messages.length && !session.observed)
                      continueIn(session, next);
                    else if (carry) {
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
            <ThreadSidebar
              snapshot={snapshot}
              selectedId={session?.id}
              onSelect={select}
              seen={seen}
              view={threadView}
              onView={setThreadView}
            />
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
