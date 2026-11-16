import { useEffect, useRef } from 'react';
import { agentKind, type Session, threadTitle } from '../../../shared/model';
import { AgentMark, Icon } from '../../components/icons';
import { moveTabFocus } from '../../lib/roving-tabs';
import { SIGNAL_LABELS, type ThreadSignal } from './tab-state';

export function SignalMark({ signal }: { signal: ThreadSignal }) {
  if (!signal) return null;
  if (signal === 'running')
    return (
      <span
        className="spinner size-2.5 shrink-0 inline-block rounded-full border-[1.5px] border-strong border-t-foreground animate-spinner motion-reduce:animate-none"
        role="img"
        aria-label={SIGNAL_LABELS.running}
        title={SIGNAL_LABELS.running}
      />
    );
  if (signal === 'terminal')
    return (
      <span
        className="shrink-0 inline-flex text-muted-foreground"
        role="img"
        aria-label={SIGNAL_LABELS.terminal}
        title={SIGNAL_LABELS.terminal}
      >
        <Icon name="terminal" size={11} />
      </span>
    );
  const color = { waiting: 'bg-warning', failed: 'bg-error', unread: 'bg-link' }[signal];
  return (
    <span
      className={`size-1.5 shrink-0 inline-block rounded-full ${color}`}
      role="img"
      aria-label={SIGNAL_LABELS[signal]}
      title={SIGNAL_LABELS[signal]}
    />
  );
}
export type TabItem =
  | { kind: 'accounts'; key: string }
  | { kind: 'skills'; key: string }
  | { kind: 'thread'; key: string; session: Session }
  /** A chat that hasn't started. `text` is what you've typed so far. */
  | { kind: 'draft'; key: string; text: string };
/** Accounts and Skills open as pages, with a fixed title and icon. */
const PAGES = {
  accounts: { title: 'Accounts', icon: 'agent' },
  skills: { title: 'Skills', icon: 'skill' },
} as const;
type PageTab = Extract<TabItem, { kind: keyof typeof PAGES }>;
function isPage(item: TabItem): item is PageTab {
  return item.kind === 'accounts' || item.kind === 'skills';
}
function tabTitle(item: TabItem): string {
  if (item.kind === 'thread') return threadTitle(item.session.title);
  if (item.kind === 'draft') return threadTitle(item.text.split('\n')[0] ?? '', 'New chat');
  return PAGES[item.kind].title;
}
function closeHint(item: TabItem): string {
  if (item.kind === 'draft') return 'Close and discard this unsent chat';
  if (item.kind !== 'thread') return `Close ${PAGES[item.kind].title}`;
  return item.session.status === 'running' || item.session.status === 'waiting'
    ? 'Close tab. The agent keeps going, and the thread stays in Chats.'
    : 'Close tab. The thread stays in Chats.';
}
/** The active tab shares the page's colour and has no line under it, so it joins what it opens. */
const TAB =
  'group flex items-center shrink-0 min-w-[84px] max-w-[190px] h-full border-r border-subtle text-muted-foreground hover:text-foreground';
const TAB_ACTIVE = 'text-foreground bg-canvas';
const TAB_IDLE = 'border-b';
const TAB_BUTTON =
  'flex-1 min-w-0 h-full justify-start gap-1.5 pl-2.5 pr-1 text-[12px] text-inherit rounded-none enabled:hover:bg-transparent';
const CLOSE =
  'shrink-0 mr-1 p-[3px] rounded-sm text-muted-foreground enabled:hover:text-foreground focus-visible:opacity-100';
/** Open threads and unsent chats, one tab each. Closing a thread's tab doesn't stop its agent. */
export function ThreadTabs({
  items,
  activeKey,
  signalOf,
  onActivate,
  onClose,
  onRename,
}: {
  items: TabItem[];
  activeKey: string;
  signalOf: (session: Session) => ThreadSignal;
  onActivate: (item: TabItem) => void;
  onClose: (item: TabItem) => void;
  onRename: (session: Session) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the active tab, or a new one
  useEffect(() => {
    strip.current
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, items.length]);
  return (
    <div
      ref={strip}
      role="tablist"
      tabIndex={-1}
      aria-label="Open threads"
      className="flex-1 min-w-0 h-full flex overflow-x-auto [scrollbar-width:none]"
      onKeyDown={(event) => moveTabFocus(event)}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        const session = item.kind === 'thread' ? item.session : undefined;
        const signal = session ? signalOf(session) : undefined;
        const title = tabTitle(item);
        // Your only, empty new chat has nothing to close.
        const closable =
          isPage(item) ||
          session ||
          items.length > 1 ||
          (item.kind === 'draft' && item.text.trim());
        return (
          <div
            key={item.key}
            className={`${TAB} ${active ? TAB_ACTIVE : TAB_IDLE}`}
            onAuxClick={(event) => {
              if (event.button === 1 && closable) onClose(item);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={`${title}${signal ? `\n${SIGNAL_LABELS[signal]}` : ''}${active && session && !session.observed ? '\nDouble-click to rename' : ''}`}
              className={TAB_BUTTON}
              onClick={() => onActivate(item)}
              onDoubleClick={() => {
                if (active && session && !session.observed) onRename(session);
              }}
            >
              <span className="inline-flex shrink-0">
                {session ? (
                  <AgentMark agent={agentKind(session)} size={12} />
                ) : (
                  <Icon name={isPage(item) ? PAGES[item.kind].icon : 'thread'} size={12} />
                )}
              </span>
              <span className={`min-w-0 truncate ${active && session ? 'session-name' : ''}`}>
                {title}
              </span>
              <SignalMark signal={signal} />
            </button>
            {closable ? (
              <button
                type="button"
                aria-label={`Close ${title}`}
                title={closeHint(item)}
                className={`${CLOSE} ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={() => onClose(item)}
              >
                <Icon name="close" size={11} />
              </button>
            ) : null}
          </div>
        );
      })}
      <div className="flex-1 min-w-2 border-b border-subtle" />
    </div>
  );
}
