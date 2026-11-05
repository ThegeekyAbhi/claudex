import { useMemo, useState } from 'react';
import {
  agentKind,
  agentLabel,
  type Session,
  type Snapshot,
  threadTitle,
} from '../../../core/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon } from '../../components/icons';
import { Hint, OverflowMenu } from '../../components/menus';
import { needsYou, type SeenAt, SIGNAL_LABELS, threadSignal } from './tab-state';
import {
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
}
const OLDER_SHOWN = 7;
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
export function ThreadSidebar({ snapshot, selectedId, onSelect, seen, view, onView }: Props) {
  const [search, setSearch] = useState('');
  const collapsed = view.collapsed ?? {};
  const showEarlier = view.showEarlier ?? {};
  const runningOnly = Boolean(view.runningOnly);
  const [showAll, setShowAll] = useState(false);
  const children = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const item of snapshot.sessions)
      if (item.parentId) map.set(item.parentId, [...(map.get(item.parentId) ?? []), item]);
    return map;
  }, [snapshot.sessions]);
  const needle = search.trim().toLowerCase();
  const matches = (item: Session): boolean =>
    !needle ||
    threadTitle(item.title).toLowerCase().includes(needle) ||
    (children.get(item.id) ?? []).some(matches);
  const known = new Set(snapshot.sessions.map((item) => item.id));
  const path = selectedPath(snapshot.sessions, selectedId);
  // Search looks through everything, so a filter can't hide what you asked for.
  const filtering = runningOnly && !needle;
  const roots = snapshot.sessions
    .filter((item) => !item.parentId || !known.has(item.parentId))
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
  const hidden = needle || showAll || filtering ? 0 : Math.max(0, older.length - OLDER_SHOWN);
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
          className={`thread group/row flex items-center rounded-md min-h-8 hover:bg-muted focus-within:bg-muted [&.active]:bg-accent ${active ? 'active' : ''}`}
        >
          {expandable ? (
            <button
              type="button"
              className="w-3.5 h-[26px] shrink-0 p-0 text-faint enabled:hover:bg-transparent enabled:hover:text-foreground"
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
            <span className="w-3.5 h-[26px] shrink-0" />
          )}
          <button
            type="button"
            className="flex-1 min-w-0 justify-start gap-2 py-1 pr-1.5 pl-0 text-left text-muted-foreground in-[.thread:hover]:text-foreground in-[.thread.active]:text-foreground enabled:hover:bg-transparent"
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
              <span
                className={`truncate text-[12.5px] ${signal === 'unread' ? 'font-medium text-foreground' : ''}`}
              >
                {title}
              </span>
              {detail ? (
                <small
                  className={`truncate text-[11px] ${signal === 'waiting' ? 'text-warning' : signal === 'failed' ? 'text-error' : 'text-faint'}`}
                >
                  {detail}
                </small>
              ) : null}
            </span>
            <span className="text-[10.5px] text-faint shrink-0 tabular-nums group-hover/row:hidden group-focus-within/row:hidden has-[~_*_[data-state=open]]:hidden">
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
                  icon: <Icon name="more" size={12} />,
                  label: item.pinned ? 'Unpin' : 'Pin',
                  onSelect: () => send({ type: 'pin', id: item.id, pinned: !item.pinned }),
                },
                {
                  key: 'rename',
                  icon: <Icon name="file" size={12} />,
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
  const group = (label: string, items: Session[]) =>
    items.length ? (
      <section>
        <h3 className="block text-[11px] font-[450] text-faint mt-0 mx-2 mb-[3px] truncate">
          {label}
        </h3>
        {items.map(thread)}
      </section>
    ) : null;
  return (
    <nav
      className="threads bg-chrome border-l border-subtle flex flex-col min-h-0 pt-1.5 px-1.5 pb-2 max-[900px]:hidden max-[900px]:border-l-0 max-[900px]:in-[.show-history]:flex max-[900px]:in-[.show-history]:absolute max-[900px]:in-[.show-history]:inset-[40px_0_0] max-[900px]:in-[.show-history]:z-30"
      aria-label="Agent sessions"
    >
      <div className="flex items-center justify-between px-2 py-2">
        <h2 className="text-xs font-semibold text-foreground">Chats</h2>
        <div className="flex items-center gap-0.5">
          <Hint label={runningOnly ? 'Showing running agents only' : 'Show running agents only'}>
            <button
              type="button"
              className={`icon-button p-[5px] enabled:hover:text-foreground ${runningOnly ? 'text-foreground bg-muted' : 'text-muted-foreground'}`}
              aria-label="Running only"
              aria-pressed={runningOnly}
              onClick={() => onView({ ...view, runningOnly: !runningOnly })}
            >
              <Icon name="filter" size={13} />
            </button>
          </Hint>
        </div>
      </div>
      <label className="flex items-center gap-1.5 mb-2 px-2 py-[5px] text-faint rounded-md focus-within:bg-muted [&_kbd]:opacity-0 in-[.threads:hover]:[&_kbd]:opacity-100 [&_input]:w-full [&_input]:text-[12px] [&_input]:text-foreground [&_input:focus-visible]:outline-none">
        <Icon name="search" size={12} />
        <span className="sr-only">Find a thread</span>
        <input
          id="thread-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a thread…"
        />
        <kbd>⌘K</kbd>
      </label>
      <div className="overflow-y-auto flex-1 flex flex-col gap-3.5">
        {group('Needs you', attention)}
        {group('Running', working)}
        {group('Pinned', pinned)}
        {group('Today', recent)}
        {group('Yesterday', lastDay)}
        {older.length ? (
          <section>
            <h3 className="block text-[11px] font-[450] text-faint mt-0 mx-2 mb-[3px] truncate">
              Older
            </h3>
            {(hidden ? older.slice(0, OLDER_SHOWN) : older).map(thread)}
            {hidden ? (
              <button
                type="button"
                className="w-full justify-start gap-[7px] min-h-[26px] py-[3px] pr-2 pl-3 text-[12px] text-faint"
                onClick={() => setShowAll(true)}
              >
                <Icon name="more" size={12} />
                More
              </button>
            ) : null}
          </section>
        ) : null}
        {!roots.length ? (
          <p className="text-muted-foreground text-[12px] m-2">
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
