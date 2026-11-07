import { agentKind, type Session, threadTitle } from '../../shared/model';
import { AgentMark } from '../components/icons';

export function RecentThreads({
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
