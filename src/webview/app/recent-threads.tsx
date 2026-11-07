import { agentKind, type Session, threadTitle } from '../../shared/model';
import { AgentMark } from '../components/icons';

const RECENT_SHOWN = 3;

export function RecentThreads({
  sessions,
  onSelect,
  onViewAll,
}: {
  sessions: Session[];
  onSelect: (session: Session) => void;
  /** Opens the full thread list. */
  onViewAll?: () => void;
}) {
  const roots = sessions.filter((item) => !item.parentId);
  const recent = roots.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_SHOWN);
  if (!recent.length) return null;
  return (
    <nav
      className="max-w-[780px] m-auto [&_button]:w-full [&_button]:justify-start [&_button]:min-h-7 [&_button]:px-2 [&_button]:py-1 [&_button]:text-[12.5px] [&_button]:text-left [&_button>span]:min-w-0 [&_button>span]:truncate"
      aria-label="Recent threads"
    >
      <div className="flex items-center justify-between mx-2 mb-[3px]">
        <span className="text-[11px] font-[450] text-faint truncate">Recent</span>
        {onViewAll && roots.length > RECENT_SHOWN ? (
          <button
            type="button"
            className="w-auto! min-h-0! px-1! py-0! text-[11px]! text-muted-foreground hover:text-foreground"
            onClick={onViewAll}
          >
            View all {roots.length}
          </button>
        ) : null}
      </div>
      {recent.map((item) => (
        <button type="button" key={item.id} onClick={() => onSelect(item)}>
          <AgentMark agent={agentKind(item)} size={13} />
          <span>{threadTitle(item.title)}</span>
        </button>
      ))}
    </nav>
  );
}
