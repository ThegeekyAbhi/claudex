import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  agentKind,
  agentLabel,
  allProfiles,
  type NativeSessionEntry,
  profileLabel,
  type Session,
  type Snapshot,
  threadTitle,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon } from '../../components/icons';
import { Hint, OverflowMenu } from '../../components/menus';
import { moveTabFocus } from '../../lib/roving-tabs';
import { needsYou, type SeenAt, SIGNAL_LABELS, threadSignal } from './tab-state';
import {
  inProfile,
  isNativeRow,
  matchesSearch,
  type NativeRow,
  nativeRows,
  olderShown,
  rootVisible,
  selectedPath,
  splitChildren,
  subtreeActive,
  type ThreadViewState,
} from './thread-filter';
import { SignalMark } from './thread-tabs';

interface Props {
  snapshot: Snapshot;
  selectedId?: string;
  onSelect: (session: Session) => void;
  seen: SeenAt;
  view: ThreadViewState;
  onView: (view: ThreadViewState) => void;
  /** Starts a new chat; absent while the workspace isn't trusted. */
  onNew?: () => void;
}
const OLDER_SHOWN = 7;
/** The shortcut as each system writes it: ⌘ on a Mac, Ctrl elsewhere. */
const FIND_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
function relativeTime(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function startOfToday(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}
/** A quiet mark for work that began in a terminal; the words are for screen readers. */
function TerminalMark() {
  return (
    <span className="inline-flex shrink-0 text-faint" title="From the terminal">
      <Icon name="terminal" size={11} />
      <span className="sr-only">, from the terminal</span>
    </span>
  );
}
/**
 * Accounts as one segmented control: a track with a highlight that slides to the chosen account.
 * It scrolls sideways rather than wrapping, so the list below never jumps.
 */
function AccountTabs({
  ids,
  selected,
  onSelect,
}: {
  ids: (string | undefined)[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number }>();
  const key = ids.join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the choice or the accounts change
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const tab = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      setThumb(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected, key]);
  return (
    <div className="mb-2 rounded-lg bg-muted p-0.5">
      <div
        ref={list}
        role="tablist"
        aria-label="Chats by account"
        className="relative flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onKeyDown={(event) => moveTabFocus(event)}
      >
        {thumb ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded-md bg-raised shadow-[0_1px_2px_#0003] outline outline-1 outline-thread-active-edge -outline-offset-1 transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
          />
        ) : null}
        {ids.map((id) => (
          <button
            key={id ?? 'all'}
            type="button"
            role="tab"
            aria-selected={selected === id}
            tabIndex={selected === id ? 0 : -1}
            title={id ? `${profileLabel(id)}: threads and terminal sessions` : 'Every account'}
            className="relative z-[1] shrink-0 gap-1.5 h-7 px-2.5 rounded-md text-[12px] text-muted-foreground enabled:hover:bg-transparent enabled:hover:text-foreground aria-selected:text-foreground aria-selected:font-medium focus-visible:outline-offset-[-2px]"
            onClick={(event) => {
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              onSelect(id);
            }}
          >
            {id ? <AgentMark agent={id} size={12} /> : null}
            <span className="truncate max-w-24">{id ? profileLabel(id) : 'All'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function ThreadSidebar({
  snapshot,
  selectedId,
  onSelect,
  seen,
  view,
  onView,
  onNew,
}: Props) {
  const [search, setSearch] = useState('');
  const collapsed = view.collapsed ?? {};
  const showEarlier = view.showEarlier ?? {};
  const runningOnly = Boolean(view.runningOnly);
  const [showAll, setShowAll] = useState(false);
  const profiles = allProfiles().map((profile) => profile.id);
  // A tab for a profile that was since removed falls back to All.
  const tab = view.profile && profiles.includes(view.profile) ? view.profile : undefined;
  const children = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const item of snapshot.sessions)
      if (item.parentId) map.set(item.parentId, [...(map.get(item.parentId) ?? []), item]);
    return map;
  }, [snapshot.sessions]);
  const needle = search.trim().toLowerCase();
  const matches = (item: Session): boolean =>
    matchesSearch(item.title, needle) || (children.get(item.id) ?? []).some(matches);
  const known = new Set(snapshot.sessions.map((item) => item.id));
  const path = selectedPath(snapshot.sessions, selectedId);
  // Search looks through everything, so a filter can't hide what you asked for.
  const filtering = runningOnly && !needle;
  const roots = snapshot.sessions
    .filter((item) => !item.parentId || !known.has(item.parentId))
    .filter((item) => inProfile(item, tab))
    .filter(matches)
    .filter((item) => !filtering || rootVisible(item, children, path))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const today = startOfToday();
  const yesterday = today - 86_400_000;
  // What needs you and what's working come first. Recency only sorts what's left.
  const attention = roots.filter((item) => needsYou(item, children, seen));
  const working = roots.filter(
    (item) => !attention.includes(item) && subtreeActive(item, children),
  );
  const settled = roots.filter((item) => !attention.includes(item) && !working.includes(item));
  const pinned = settled.filter((item) => item.pinned);
  const unpinned = settled.filter((item) => !item.pinned);
  const recent = unpinned.filter((item) => item.updatedAt >= today || path.has(item.id));
  const lastDay = unpinned.filter((item) => !recent.includes(item) && item.updatedAt >= yesterday);
  const older = unpinned.filter((item) => !recent.includes(item) && !lastDay.includes(item));
  const natives = nativeRows(snapshot.nativeSessions, {
    profile: tab,
    needle,
    runningOnly: filtering,
    profiles,
  });
  type Row = Session | NativeRow;
  const withNative = (items: Session[], from: number, until = Number.POSITIVE_INFINITY): Row[] =>
    [
      ...items,
      ...natives.filter((entry) => entry.updatedAt >= from && entry.updatedAt < until),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
  const recentRows = withNative(recent, today);
  const lastDayRows = withNative(lastDay, yesterday, today);
  const olderRows = withNative(older, 0, yesterday);
  // Terminal sessions don't push your threads behind "More"; each kind gets its own share.
  const olderVisible =
    needle || showAll || filtering ? olderRows : olderShown(olderRows, OLDER_SHOWN);
  const hidden = olderRows.length - olderVisible.length;
  const row = (item: Row) => (isNativeRow(item) ? nativeRow(item) : thread(item));
  /** A session from the CLI's own history: opening it makes it a thread here, same session. */
  function nativeRow(entry: NativeSessionEntry) {
    const title = threadTitle(entry.title);
    return (
      <div
        key={`native-${entry.profileId}-${entry.sessionId}`}
        className="thread group/row flex items-center rounded-lg min-h-9 pr-0.5 hover:bg-muted focus-within:bg-muted"
      >
        <span className="w-4 shrink-0" />
        <button
          type="button"
          className="flex-1 min-w-0 self-stretch justify-start gap-2.5 py-1.5 pr-1.5 pl-0.5 rounded-lg text-left text-muted-foreground in-[.thread:hover]:text-foreground enabled:hover:bg-transparent focus-visible:outline-offset-[-2px]"
          title={`${title}\n${profileLabel(entry.profileId)} · from the terminal. Opening it continues the same session.`}
          aria-label={`${title}, from the terminal`}
          data-native-session={entry.sessionId}
          onClick={() =>
            send({ type: 'openNativeSession', agent: entry.profileId, sessionId: entry.sessionId })
          }
        >
          <span className="relative inline-flex shrink-0 items-center justify-center size-[18px]">
            <AgentMark agent={entry.profileId} size={13} />
          </span>
          <span className="min-w-0 flex-1 flex items-center gap-1.5 leading-[1.3]">
            <span className="truncate text-[13px]">{title}</span>
            <span className="inline-flex shrink-0 text-faint" aria-hidden="true">
              <Icon name="terminal" size={11} />
            </span>
          </span>
          <span className="text-[11px] text-faint shrink-0 tabular-nums">
            {relativeTime(entry.updatedAt)}
          </span>
        </button>
      </div>
    );
  }
  function thread(item: Session) {
    const all = (children.get(item.id) ?? []).filter(matches);
    const split = needle ? { current: all, earlier: [] } : splitChildren(all, children, path);
    const earlierOpen = Boolean(showEarlier[item.id]) && !filtering;
    const kids = earlierOpen ? all : split.current;
    const expandable = all.length > 0;
    const open = expandable && !collapsed[item.id];
    const active = item.id === selectedId;
    const runningKids = all.filter((kid) => subtreeActive(kid, children)).length;
    const signal =
      active && item.status === 'completed' ? undefined : threadSignal(item, children, seen);
    const shownSignal = signal ?? (runningKids ? 'running' : undefined);
    const title = threadTitle(item.title);
    // Words as well as colour, and only when there's something to say.
    const detail =
      signal === 'waiting' || signal === 'terminal'
        ? SIGNAL_LABELS[signal]
        : signal === 'failed'
          ? SIGNAL_LABELS.failed
          : item.status === 'interrupted'
            ? 'Interrupted'
            : shownSignal === 'running'
              ? [
                  ...(item.status === 'running' ? ['Running'] : []),
                  ...(runningKids
                    ? [`${runningKids} ${runningKids === 1 ? 'subagent' : 'subagents'} running`]
                    : []),
                ].join(' · ')
              : undefined;
    const lines = [...kids, ...(split.earlier.length && !filtering ? [undefined] : [])];
    return (
      <div key={item.id} className="thread-node">
        <div
          className={`thread group/row flex items-center rounded-lg min-h-9 pr-0.5 hover:bg-muted focus-within:bg-muted [&.active]:bg-thread-active [&.active]:outline [&.active]:outline-1 [&.active]:outline-thread-active-edge [&.active]:-outline-offset-1 ${active ? 'active' : ''}`}
        >
          {expandable ? (
            <button
              type="button"
              className="w-4 self-stretch shrink-0 p-0 rounded-md text-faint enabled:hover:bg-transparent enabled:hover:text-foreground focus-visible:outline-offset-[-2px]"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
              aria-expanded={open}
              onClick={() => onView({ ...view, collapsed: { ...collapsed, [item.id]: open } })}
            >
              <span
                className={`inline-flex text-muted-foreground transition-transform duration-[120ms] ease-[ease] [&.open]:rotate-90 motion-reduce:transition-none ${open ? 'open' : ''}`}
              >
                <Icon name="chevron" size={9} />
              </span>
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            type="button"
            className="flex-1 min-w-0 self-stretch justify-start gap-2.5 py-1.5 pr-1.5 pl-0.5 rounded-lg text-left text-muted-foreground in-[.thread:hover]:text-foreground in-[.thread.active]:text-thread-active-foreground in-[.thread.active]:font-medium enabled:hover:bg-transparent focus-visible:outline-offset-[-2px]"
            onClick={() => onSelect(item)}
            title={`${title}\n${agentLabel(item)} · ${item.cwd}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="relative inline-flex shrink-0 items-center justify-center size-[18px]">
              <AgentMark agent={agentKind(item)} size={13} />
              {shownSignal ? (
                <span className="absolute -right-[3px] -bottom-[3px] inline-flex items-center justify-center size-[9px] rounded-full bg-chrome [&_.spinner]:size-[9px] [&_.spinner]:border-[1.25px]">
                  <SignalMark signal={shownSignal} />
                </span>
              ) : null}
            </span>
            <span className="min-w-0 flex-1 flex flex-col leading-[1.3]">
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`truncate text-[13px] ${signal === 'unread' ? 'font-medium text-foreground' : ''}`}
                >
                  {title}
                </span>
                {item.origin === 'terminal' ? <TerminalMark /> : null}
              </span>
              {detail ? (
                <small
                  className={`truncate text-[11.5px] ${signal === 'waiting' ? 'text-warning' : signal === 'failed' ? 'text-error' : 'text-faint'}`}
                >
                  {detail}
                </small>
              ) : null}
            </span>
            <span className="text-[11px] text-faint shrink-0 tabular-nums group-hover/row:hidden group-focus-within/row:hidden has-[~_*_[data-state=open]]:hidden">
              {relativeTime(item.updatedAt)}
            </span>
          </button>
          <div className="w-0 overflow-hidden opacity-0 group-hover/row:w-auto group-hover/row:overflow-visible group-hover/row:opacity-100 group-focus-within/row:w-auto group-focus-within/row:overflow-visible group-focus-within/row:opacity-100 has-[[data-state=open]]:w-auto has-[[data-state=open]]:overflow-visible has-[[data-state=open]]:opacity-100">
            <OverflowMenu
              items={[
                {
                  key: 'open',
                  icon: <Icon name="file" size={12} />,
                  label: 'Open in editor',
                  onSelect: () => send({ type: 'openChat', id: item.id }),
                },
                {
                  key: 'pin',
                  icon: <Icon name="pin" size={12} />,
                  label: item.pinned ? 'Unpin' : 'Pin',
                  onSelect: () => send({ type: 'pin', id: item.id, pinned: !item.pinned }),
                },
                {
                  key: 'rename',
                  icon: <Icon name="edit" size={12} />,
                  label: 'Rename',
                  onSelect: () => send({ type: 'rename', id: item.id }),
                },
                {
                  key: 'delete',
                  icon: <Icon name="close" size={12} />,
                  label: 'Delete',
                  disabled: item.status === 'running' || item.status === 'waiting',
                  onSelect: () => send({ type: 'deleteThread', id: item.id }),
                },
              ]}
            />
          </div>
        </div>
        {open && lines.length ? (
          <div className="ml-[22px]">
            {lines.map((kid) => (
              <div
                key={kid?.id ?? 'earlier'}
                className="relative pl-2.5 before:absolute before:left-0 before:top-0 before:h-4 before:w-2 before:rounded-bl-md before:border-b before:border-l before:border-strong not-last:after:absolute not-last:after:left-0 not-last:after:top-0 not-last:after:bottom-0 not-last:after:border-l not-last:after:border-strong"
              >
                {kid ? (
                  thread(kid)
                ) : (
                  <button
                    type="button"
                    className="w-full justify-start min-h-7 py-1 px-1.5 text-[11px] text-faint enabled:hover:text-foreground"
                    aria-expanded={earlierOpen}
                    onClick={() =>
                      onView({ ...view, showEarlier: { ...showEarlier, [item.id]: !earlierOpen } })
                    }
                  >
                    {earlierOpen ? 'Hide earlier' : `${split.earlier.length} earlier`}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  const group = (label: string, items: Row[]) =>
    items.length ? (
      <section>
        <h3 className="sticky top-0 z-[2] block m-0 px-2 py-1 bg-chrome text-[11.5px] font-medium text-muted-foreground truncate">
          {label}
        </h3>
        {items.map(row)}
      </section>
    ) : null;
  return (
    <nav
      className="threads bg-chrome border-r border-subtle flex flex-col min-h-0 px-2 pb-2 max-[900px]:hidden max-[900px]:border-r-0 max-[900px]:in-[.show-history]:flex max-[900px]:in-[.show-history]:absolute max-[900px]:in-[.show-history]:inset-[40px_0_0] max-[900px]:in-[.show-history]:z-30"
      aria-label="Agent sessions"
    >
      <div className="flex items-center justify-between h-10 shrink-0 pl-2">
        <h2 className="m-0 text-[13px] font-semibold text-foreground">Chats</h2>
        <div className="flex items-center gap-0.5">
          <Hint label={runningOnly ? 'Showing running agents only' : 'Show running agents only'}>
            <button
              type="button"
              className={`icon-button p-[6px] rounded-md enabled:hover:text-foreground enabled:hover:bg-muted ${runningOnly ? 'text-foreground bg-accent' : 'text-muted-foreground'}`}
              aria-label="Running only"
              aria-pressed={runningOnly}
              onClick={() => onView({ ...view, runningOnly: !runningOnly })}
            >
              <Icon name="filter" size={13} />
            </button>
          </Hint>
        </div>
      </div>
      <button
        type="button"
        className="w-full justify-start gap-2.5 min-h-9 mb-2 px-2 rounded-lg text-[13px] text-foreground enabled:hover:bg-muted focus-visible:outline-offset-[-2px]"
        aria-label="Start a new chat"
        disabled={!onNew}
        onClick={onNew}
      >
        <Icon name="newChat" size={15} />
        New chat
      </button>
      {profiles.length > 1 ? (
        <AccountTabs
          ids={[undefined, ...profiles]}
          selected={tab}
          onSelect={(id) => onView({ ...view, profile: id })}
        />
      ) : null}
      <label className="relative flex items-center gap-2 mb-3 px-2.5 min-h-8 text-faint rounded-lg bg-raised border border-transparent focus-within:border-[var(--focus)] [&_kbd]:opacity-0 in-[.threads:hover]:[&_kbd]:opacity-100 focus-within:[&_kbd]:opacity-100 [&_input]:w-full [&_input]:text-[12.5px] [&_input]:text-foreground [&_input:focus-visible]:outline-none">
        <Icon name="search" size={13} />
        <span className="sr-only">Find a thread</span>
        <input
          id="thread-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a thread…"
        />
        <kbd>{FIND_KEY}</kbd>
      </label>
      <div className="overflow-y-auto flex-1 flex flex-col gap-3 -mx-1 px-1">
        {group('Needs you', attention)}
        {group('Running', working)}
        {group('Pinned', pinned)}
        {group('Today', recentRows)}
        {group('Yesterday', lastDayRows)}
        {olderRows.length ? (
          <section>
            <h3 className="sticky top-0 z-[2] block m-0 px-2 py-1 bg-chrome text-[11.5px] font-medium text-muted-foreground truncate">
              Older
            </h3>
            {olderVisible.map(row)}
            {hidden ? (
              <button
                type="button"
                className="w-full justify-start gap-2 min-h-8 py-1 pr-2 pl-2.5 rounded-lg text-[12.5px] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground focus-visible:outline-offset-[-2px]"
                onClick={() => setShowAll(true)}
              >
                <Icon name="more" size={12} />
                More
              </button>
            ) : null}
          </section>
        ) : null}
        {!roots.length && !natives.length ? (
          <p className="text-muted-foreground text-[12.5px] m-2">
            {search
              ? 'No matching threads.'
              : runningOnly
                ? 'No agents are running.'
                : 'Threads you start appear here.'}
          </p>
        ) : null}
      </div>
    </nav>
  );
}
