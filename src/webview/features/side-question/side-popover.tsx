import { useEffect, useRef, useState } from 'react';
import type { Provider } from '../../../shared/model';
import { CopyButton } from '../../components/copy-button';
import { Icon } from '../../components/icons';
import { MarkdownText } from '../../lib/markdown';
import type { SideAnswer } from './use-side-questions';

/** What each agent may do for a side question; the host enforces it, this only says it. */
const REACH: Record<Provider, { short: string; long: string }> = {
  claude: { short: 'no tools', long: 'Claude answers from the conversation, with no tools.' },
  codex: {
    short: 'read-only',
    long: 'Codex may read files or run read-only commands to answer; it can’t change anything.',
  },
};

const ACTION =
  'px-1.5 py-0.5 rounded text-[11.5px] text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-muted';

/**
 * Side questions float above the message box, apart from the transcript, because they are not
 * part of the thread: the agent never sees them in its history and they are not saved. The newest
 * answer is open; earlier ones fold to a line each.
 */
export function SidePopover({
  items,
  agent,
  provider,
  onStop,
  onRetry,
  onAskInThread,
  onClose,
  onClear,
}: {
  items: SideAnswer[];
  agent: string;
  provider: Provider;
  onStop: (requestId: string) => void;
  onRetry: (requestId: string) => void;
  onAskInThread: (question: string) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const last = items.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the newest answer as it streams
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [last?.answer, last?.activity?.length, items.length]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!items.length) return null;
  const reach = REACH[provider];
  const toggle = (requestId: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(requestId)) next.add(requestId);
      return next;
    });
  return (
    <section
      aria-label="Side questions"
      className="side-popover mx-6 mb-1.5 max-w-[780px] self-center w-[calc(100%-48px)] rounded-lg border border-strong bg-overlay [box-shadow:var(--shadow)] max-[900px]:mx-3 max-[900px]:w-[calc(100%-24px)]"
    >
      <header className="flex items-center gap-1.5 border-b border-subtle py-1 pr-1 pl-3 text-[11.5px] text-muted-foreground">
        <Icon name="aside" size={13} />
        <span className="font-medium text-foreground">Side questions</span>
        <span
          className="side-reach min-w-0 truncate text-faint"
          title={`${reach.long} Not saved to the thread or the agent’s history.`}
        >
          {agent} · {reach.short} · not saved
        </span>
        <span className="ml-auto flex shrink-0 items-center">
          <button type="button" className={ACTION} onClick={onClear}>
            Clear
          </button>
          <button
            type="button"
            className="icon-button p-[5px] text-muted-foreground enabled:hover:text-foreground"
            aria-label="Hide side questions"
            title="Hide · Esc"
            onClick={onClose}
          >
            <Icon name="close" size={13} />
          </button>
        </span>
      </header>
      <div className="max-h-[min(360px,45vh)] overflow-y-auto px-2 py-1.5">
        {items.map((item) =>
          item === last || opened.has(item.requestId) ? (
            <Answer
              key={item.requestId}
              item={item}
              {...(item === last ? {} : { onFold: () => toggle(item.requestId) })}
              onStop={onStop}
              onRetry={onRetry}
              onAskInThread={onAskInThread}
            />
          ) : (
            <button
              key={item.requestId}
              type="button"
              className="side-folded flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-expanded={false}
              title="Show this answer"
              onClick={() => toggle(item.requestId)}
            >
              <StatusDot status={item.status} />
              <span className="min-w-0 flex-1 truncate">{item.question}</span>
              <Icon name="chevron" size={11} />
            </button>
          ),
        )}
        <div ref={end} />
      </div>
    </section>
  );
}

function Answer({
  item,
  onFold,
  onStop,
  onRetry,
  onAskInThread,
}: {
  item: SideAnswer;
  /** Set for an earlier answer opened from its folded line. */
  onFold?: () => void;
  onStop: (requestId: string) => void;
  onRetry: (requestId: string) => void;
  onAskInThread: (question: string) => void;
}) {
  const ended = item.status === 'failed' || item.status === 'stopped';
  return (
    <article className="side-answer rounded px-1.5 py-1">
      <div className="flex items-start gap-2 text-[12px] text-muted-foreground">
        <StatusDot status={item.status} />
        <span className="min-w-0 flex-1 break-words">{item.question}</span>
        {onFold ? (
          <button
            type="button"
            className={ACTION}
            aria-expanded
            title="Fold this answer"
            onClick={onFold}
          >
            Fold
          </button>
        ) : null}
      </div>
      {item.activity?.length ? <Activity items={item.activity} /> : null}
      <div className="markdown reply pl-4 text-[13px]">
        {item.answer ? (
          <MarkdownText text={item.answer} streaming={item.status === 'answering'} />
        ) : item.status === 'answering' ? (
          <p className="shimmer m-0" aria-live="polite">
            Answering…
          </p>
        ) : null}
      </div>
      {item.status === 'failed' ? (
        <p className="m-0 pl-4 text-[12px] text-warning" role="alert">
          {item.error ?? 'The side question failed.'}
        </p>
      ) : null}
      {item.status === 'stopped' ? (
        <p className="m-0 pl-4 text-[12px] text-muted-foreground">Stopped.</p>
      ) : null}
      <div className="flex items-center gap-0.5 pl-2.5 pt-0.5">
        {item.status === 'answering' ? (
          <button type="button" className={ACTION} onClick={() => onStop(item.requestId)}>
            Stop
          </button>
        ) : (
          <>
            {ended ? (
              <button
                type="button"
                className={ACTION}
                title="Ask this side question again"
                onClick={() => onRetry(item.requestId)}
              >
                Retry
              </button>
            ) : null}
            {item.answer ? <CopyButton text={item.answer} /> : null}
            <button
              type="button"
              className={ACTION}
              title="Put this question in the message box, to ask it in the thread"
              onClick={() => onAskInThread(item.question)}
            >
              Ask in thread
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** What the agent looked at, as one quiet line that opens to the list. */
function Activity({ items }: { items: string[] }) {
  const reads = items.filter((item) => item.startsWith('Read '));
  const summary =
    items.length === 1
      ? items[0]
      : reads.length === items.length
        ? `Read ${items.length} files`
        : `${items.length} steps`;
  return (
    <details className="side-activity pl-4 text-[11.5px] text-faint">
      <summary className="cursor-pointer truncate select-none hover:text-muted-foreground">
        {summary}
      </summary>
      {items.length > 1 ? (
        <ul className="m-0 list-none py-0.5 pl-3">
          {items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows, in order
            <li key={index} className="truncate" title={item}>
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function StatusDot({ status }: { status: SideAnswer['status'] }) {
  const tone =
    status === 'answering'
      ? 'bg-[var(--focus)] animate-pulse motion-reduce:animate-none'
      : status === 'failed'
        ? 'bg-warning'
        : status === 'stopped'
          ? 'bg-faint'
          : 'bg-success';
  return (
    <span
      role="img"
      aria-label={status}
      className={`mt-[5px] inline-block size-1.5 shrink-0 rounded-full ${tone}`}
    />
  );
}
