import { useMemo, useState } from 'react';
import { agentKind, agentLabel, type Session, type Snapshot } from '../model';
import { AgentMark, Icon } from './icons';

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
  const recent = roots.filter(isRecent);
  const older = roots.filter((item) => !isRecent(item));
  const hidden = needle || showAll ? 0 : Math.max(0, older.length - OLDER_SHOWN);
  function thread(item: Session) {
    const kids = (children.get(item.id) ?? []).filter(matches);
    const open = kids.length > 0 && !collapsed[item.id];
    const needsYou = kids.some((kid) => kid.status === 'waiting');
    return (
      <div key={item.id} className="thread-node">
        <div className={`thread ${item.id === selectedId ? 'active' : ''}`}>
          {kids.length ? (
            <button
              type="button"
              className="thread-chevron"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`}
              aria-expanded={open}
              onClick={() => setCollapsed((value) => ({ ...value, [item.id]: open }))}
            >
              <span className={`chevron ${open ? 'open' : ''}`}>
                <Icon name="chevron" size={9} />
              </span>
            </button>
          ) : (
            <span className="thread-chevron-space" />
          )}
          <button
            type="button"
            className="thread-main"
            onClick={() => onSelect(item)}
            title={`${item.title}\n${agentLabel(item)} · ${item.cwd}`}
            aria-current={item.id === selectedId ? 'page' : undefined}
          >
            <span className="thread-state">
              {item.status === 'running' ? (
                <span className="spinner" role="img" aria-label="Running" />
              ) : item.status === 'waiting' || needsYou ? (
                <span className="status-dot waiting" role="img" aria-label="Waiting for you" />
              ) : item.status === 'failed' ? (
                <span className="status-dot failed" role="img" aria-label="Failed" />
              ) : (
                <span className="status-dot quiet" />
              )}
            </span>
            <span className="thread-title">{item.title}</span>
            <span className="thread-agent">
              <AgentMark agent={agentKind(item)} size={11} />
            </span>
            <span className="thread-time">{relativeTime(item.updatedAt)}</span>
          </button>
        </div>
        {open ? <div className="thread-children">{kids.map(thread)}</div> : null}
      </div>
    );
  }
  return (
    <nav className="threads" aria-label="Agent sessions">
      <label className="search">
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
      <div className="thread-list">
        {recent.length ? (
          <section>
            <h3 className="section-label">Recent</h3>
            {recent.map(thread)}
          </section>
        ) : null}
        {older.length ? (
          <section>
            <h3 className="section-label">Older</h3>
            {(hidden ? older.slice(0, OLDER_SHOWN) : older).map(thread)}
            {hidden ? (
              <button type="button" className="thread-more" onClick={() => setShowAll(true)}>
                <Icon name="more" size={12} />
                More
              </button>
            ) : null}
          </section>
        ) : null}
        {!roots.length ? (
          <p className="sidebar-empty">
            {search ? 'No matching threads.' : 'Threads you start appear here.'}
          </p>
        ) : null}
      </div>
    </nav>
  );
}
