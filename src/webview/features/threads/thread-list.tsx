import { useMemo, useState } from 'react';
import { agentKind, agentLabel, type Session, type Snapshot } from '../../../core/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon } from '../../components/icons';
import { OverflowMenu } from '../../components/menus';

interface Props {
  snapshot: Snapshot;
  selectedId?: string;
  onSelect: (session: Session) => void;
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
export function ThreadSidebar({ snapshot, selectedId, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
    item.title.toLowerCase().includes(needle) ||
    (children.get(item.id) ?? []).some(matches);
  const known = new Set(snapshot.sessions.map((item) => item.id));
  const roots = snapshot.sessions
    .filter((item) => !item.parentId || !known.has(item.parentId))
    .filter(matches)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const today = startOfToday();
  // A thread that needs you never sinks into a collapsed group.
  const isRecent = (item: Session) =>
    item.updatedAt >= today ||
    item.status === 'running' ||
    item.status === 'waiting' ||
    item.id === selectedId;
  const pinned = roots.filter((item) => item.pinned);
  const recent = roots.filter((item) => !item.pinned && isRecent(item));
  const older = roots.filter((item) => !item.pinned && !isRecent(item));
  const hidden = needle || showAll ? 0 : Math.max(0, older.length - OLDER_SHOWN);
  function thread(item: Session) {
    const kids = (children.get(item.id) ?? []).filter(matches);
    const open = kids.length > 0 && !collapsed[item.id];
    const needsYou = kids.some((kid) => kid.status === 'waiting');
    return (
      <div key={item.id} className="thread-node">
        <div
          className={`thread flex items-center rounded-md min-h-9 hover:bg-muted [&.active]:bg-accent [&.active]:ring-1 [&.active]:ring-inset [&.active]:ring-strong ${item.id === selectedId ? 'active' : ''}`}
        >
          {kids.length ? (
            <button
              type="button"
              className="w-3 h-[26px] shrink-0 p-0 text-faint enabled:hover:bg-transparent enabled:hover:text-foreground"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`}
              aria-expanded={open}
              onClick={() => setCollapsed((value) => ({ ...value, [item.id]: open }))}
            >
              <span
                className={`inline-flex text-muted-foreground transition-transform duration-[120ms] ease-[ease] [&.open]:rotate-90 motion-reduce:transition-none ${open ? 'open' : ''}`}
              >
                <Icon name="chevron" size={9} />
              </span>
            </button>
          ) : (
            <span className="w-3 h-[26px] shrink-0 p-0 text-faint" />
          )}
          <button
            type="button"
            className="flex-1 min-w-0 justify-start gap-[7px] py-[3px] pr-[7px] pl-0 text-left text-muted-foreground in-[.thread:hover]:text-foreground in-[.thread.active]:text-foreground enabled:hover:bg-transparent"
            onClick={() => onSelect(item)}
            title={`${item.title}\n${agentLabel(item)} · ${item.cwd}`}
            aria-current={item.id === selectedId ? 'page' : undefined}
          >
            <span className="w-3 inline-flex justify-center shrink-0 [&_.spinner]:size-2.5">
              {item.status === 'running' ? (
                <span
                  className="spinner size-[11px] shrink-0 inline-block rounded-full border-[1.5px] border-strong border-t-foreground animate-spinner motion-reduce:animate-none"
                  role="img"
                  aria-label="Running"
                />
              ) : item.status === 'waiting' || needsYou ? (
                <span
                  className="status-dot size-1.5 rounded-full bg-muted-foreground shrink-0 inline-block [&.quiet]:bg-faint [&.quiet]:opacity-50 [&.waiting]:bg-warning [&.failed]:bg-error in-[.rail-item]:ml-auto waiting"
                  role="img"
                  aria-label="Waiting for you"
                />
              ) : item.status === 'failed' ? (
                <span
                  className="status-dot size-1.5 rounded-full bg-muted-foreground shrink-0 inline-block [&.quiet]:bg-faint [&.quiet]:opacity-50 [&.waiting]:bg-warning [&.failed]:bg-error in-[.rail-item]:ml-auto failed"
                  role="img"
                  aria-label="Failed"
                />
              ) : (
                <span className="status-dot size-1.5 rounded-full bg-muted-foreground shrink-0 inline-block [&.quiet]:bg-faint [&.quiet]:opacity-50 [&.waiting]:bg-warning [&.failed]:bg-error in-[.rail-item]:ml-auto quiet" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px]">{item.title}</span>
            <span className="inline-flex shrink-0">
              <AgentMark agent={agentKind(item)} size={11} />
            </span>
            <span className="text-[10.5px] text-faint shrink-0 tabular-nums">
              {relativeTime(item.updatedAt)}
            </span>
          </button>
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
        {open ? <div className="ml-4 pl-1 border-l border-strong">{kids.map(thread)}</div> : null}
      </div>
    );
  }
  return (
    <nav
      className="threads bg-canvas border-l border-subtle flex flex-col min-h-0 pt-1.5 px-1.5 pb-2 max-[900px]:hidden max-[900px]:border-l-0 max-[900px]:in-[.show-history]:flex max-[900px]:in-[.show-history]:absolute max-[900px]:in-[.show-history]:inset-[40px_0_0] max-[900px]:in-[.show-history]:z-30"
      aria-label="Agent sessions"
    >
      <div className="flex items-center justify-between px-2 py-2">
        <h2 className="text-xs font-semibold text-foreground">Chats</h2>
        <button
          type="button"
          className="text-xs text-muted-foreground px-2 py-1"
          onClick={() => send({ type: 'openChat' })}
        >
          + New chat
        </button>
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
        {pinned.length ? (
          <section>
            <h3 className="mx-2 mb-1 text-xs text-faint">Pinned</h3>
            {pinned.map(thread)}
          </section>
        ) : null}
        {recent.length ? (
          <section>
            <h3 className="block text-[11px] font-[450] text-faint mt-0 mx-2 mb-[3px] truncate">
              Today
            </h3>
            {recent.map(thread)}
          </section>
        ) : null}
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
            {search ? 'No matching threads.' : 'Threads you start appear here.'}
          </p>
        ) : null}
      </div>
    </nav>
  );
}
