import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AGENT_LABELS,
  type Approval,
  agentKind,
  agentLabel,
  type FileDiff,
  type Message,
  type Session,
  type ToolInfo,
} from '../model';
import { send } from './bridge';
import { AttachmentChip } from './context-menu';
import { DiffCard, DiffStat } from './diff-view';
import { AgentMark, Icon, type IconName } from './icons';
import { ImageMessage } from './image-view';
import { MarkdownText } from './markdown';
import { PlanCard } from './plan-card';
import { isQuestion } from './question-card';

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`chevron ${open ? 'open' : ''}`}>
      <Icon name="chevron" size={11} />
    </span>
  );
}
function StepState({ status }: { status: ToolInfo['status'] }) {
  if (status === 'running') return <span className="spinner" role="img" aria-label="Running" />;
  if (status === 'failed')
    return (
      <span className="step-state failed" role="img" aria-label="Failed">
        <Icon name="x" size={12} />
      </span>
    );
  if (status === 'declined')
    return (
      <span className="step-state declined" role="img" aria-label="Declined">
        <Icon name="x" size={12} />
      </span>
    );
  return (
    <span className="step-state done" role="img" aria-label="Done">
      <Icon name="check" size={12} />
    </span>
  );
}
const VERBS: Record<ToolInfo['kind'], [running: string, done: string]> = {
  command: ['Running', 'Ran'],
  read: ['Reading', 'Read'],
  edit: ['Editing', 'Edited'],
  search: ['Searching', 'Searched'],
  web: ['Fetching', 'Fetched'],
  agent: ['Running', 'Ran'],
  other: ['Calling', 'Called'],
};
const ICONS: Record<ToolInfo['kind'], IconName> = {
  command: 'terminal',
  read: 'read',
  edit: 'edit',
  search: 'search',
  web: 'globe',
  agent: 'agent',
  other: 'wrench',
};
function verb(tool: ToolInfo): string {
  const [running, done] = VERBS[tool.kind];
  if (tool.status === 'running') return running;
  if (tool.status === 'failed') return `Failed: ${running.toLowerCase()}`;
  if (tool.status === 'declined') return `Declined: ${running.toLowerCase()}`;
  return done;
}
function ToolStep({ message }: { message: Message }) {
  const tool = message.tool as ToolInfo;
  const [open, setOpen] = useState(false);
  const code = tool.kind === 'command' || tool.kind === 'search';
  const detail = [tool.input, message.text].filter(Boolean).join('\n\n');
  const body = (
    <>
      <Icon name={ICONS[tool.kind]} size={13} />
      <span className="step-text">
        <span className="step-verb">{verb(tool)}</span>{' '}
        {code ? <code>{tool.title}</code> : <span>{tool.title}</span>}
      </span>
      {tool.durationMs !== undefined && tool.durationMs >= 1000 ? (
        <span className="step-meta">{duration(tool.durationMs)}</span>
      ) : null}
      <StepState status={tool.status} />
    </>
  );
  if (!detail) return <div className="step">{body}</div>;
  return (
    <div className="step-wrap">
      <button
        type="button"
        className="step interactive"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {body}
        <Chevron open={open} />
      </button>
      {open ? <pre className="step-output">{detail}</pre> : null}
    </div>
  );
}
function LegacyTool({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="step-wrap">
      <button
        type="button"
        className="step interactive"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="terminal" size={13} />
        <span className="step-text">{text.split('\n')[0].slice(0, 160) || 'Tool activity'}</span>
        <Chevron open={open} />
      </button>
      {open ? <pre className="step-output">{text}</pre> : null}
    </div>
  );
}
function Reasoning({ message, active }: { message: Message; active: boolean }) {
  const streaming = active && !message.endedAt;
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? streaming;
  const seconds =
    message.startedAt && message.endedAt
      ? duration(Math.max(1000, message.endedAt - message.startedAt))
      : undefined;
  return (
    <div className="step-wrap">
      <button
        type="button"
        className="step interactive reasoning-toggle"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
      >
        <Icon name="brain" size={13} />
        <span className={`step-text ${streaming ? 'shimmer' : ''}`}>
          {streaming ? 'Thinking…' : seconds ? `Thought for ${seconds}` : 'Thought'}
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="reasoning-body markdown">
          <MarkdownText text={message.text} />
        </div>
      ) : null}
    </div>
  );
}
function activitySummary(items: Message[]): string {
  const count = (kind: ToolInfo['kind']) => items.filter((m) => m.tool?.kind === kind).length;
  const plural = (value: number, noun: string, many = `${noun}s`) =>
    `${value} ${value === 1 ? noun : many}`;
  const parts: string[] = [];
  if (count('edit')) parts.push(`edited ${plural(count('edit'), 'file')}`);
  if (count('command')) parts.push(`ran ${plural(count('command'), 'command')}`);
  if (count('read')) parts.push(`read ${plural(count('read'), 'file')}`);
  if (count('search')) parts.push(`ran ${plural(count('search'), 'search', 'searches')}`);
  if (count('web')) parts.push(`fetched ${plural(count('web'), 'page')}`);
  if (count('other')) parts.push(`used ${plural(count('other'), 'tool')}`);
  // Threads from before tool details were recorded have only plain rows.
  const plain = items.filter((m) => m.role === 'tool' && !m.tool).length;
  if (plain) parts.push(`ran ${plural(plain, 'step')}`);
  if (!parts.length) return 'Thought it through';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}
function diffsOf(items: Message[]): FileDiff[] {
  return items.flatMap((message) =>
    message.tool?.status === 'declined' || message.tool?.status === 'failed'
      ? []
      : (message.tool?.diffs ?? []),
  );
}
function ActivityGroup({
  items,
  active,
  sessionId,
}: {
  items: Message[];
  active: boolean;
  sessionId: string;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? active;
  const failed = items.some((message) => message.tool?.status === 'failed');
  const diffs = diffsOf(items);
  const totals = diffs.reduce(
    (sum, diff) => ({
      additions: sum.additions + diff.additions,
      deletions: sum.deletions + diff.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return (
    <div className="activity">
      <button
        type="button"
        className="activity-toggle"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
      >
        <Chevron open={open} />
        <span className={active ? 'shimmer' : ''}>
          {active ? 'Working…' : activitySummary(items)}
        </span>
        {failed ? <span className="activity-failed">with failures</span> : null}
        {diffs.length ? <DiffStat {...totals} /> : null}
      </button>
      {open ? (
        <div className="activity-body">
          {items.map((message) =>
            message.role === 'thinking' ? (
              <Reasoning key={message.id} message={message} active={active} />
            ) : message.tool ? (
              <ToolStep key={message.id} message={message} />
            ) : (
              <LegacyTool key={message.id} text={message.text} />
            ),
          )}
        </div>
      ) : null}
      {/* Diffs stay visible when the steps above are collapsed. */}
      {diffs.map((diff, index) => (
        <DiffCard key={`${diff.path}-${index}`} diff={diff} sessionId={sessionId} />
      ))}
    </div>
  );
}
function ChildTranscript({ session }: { session: Session }) {
  const segments = segment(session.messages);
  return (
    <div className="subagent-transcript">
      {segments.map((item, index) =>
        item.type === 'activity' ? (
          <ActivityGroup
            key={item.items[0].id}
            items={item.items}
            active={session.status === 'running' && index === segments.length - 1}
            sessionId={session.id}
          />
        ) : item.message.role === 'user' ? null : (
          <MessageRow key={item.message.id} message={item.message} />
        ),
      )}
      {!session.messages.length ? (
        <p className="muted subagent-empty">
          {session.status === 'running'
            ? 'Waiting for its first output…'
            : 'No output was reported.'}
        </p>
      ) : null}
    </div>
  );
}
const WORKER_STATUS: Record<Session['status'], [running: string, done: string]> = {
  idle: ['Waiting to start', 'Waiting to start'],
  running: ['Running', 'Running'],
  waiting: ['Waiting for you', 'Waiting for you'],
  completed: ['Ran', 'Ran'],
  failed: ['Failed', 'Failed'],
  interrupted: ['Stopped', 'Stopped'],
};
function SubagentCard({
  message,
  child,
  parent,
  onOpen,
  onUseResult,
}: {
  message: Message;
  child?: Session;
  parent: Session;
  onOpen: (session: Session) => void;
  onUseResult: (text: string) => void;
}) {
  const running = child?.status === 'running' || child?.status === 'waiting';
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? (child?.status === 'running' || child?.status === 'waiting');
  const tool = message.tool as ToolInfo;
  const agentName = child ? agentLabel(child) : 'agent';
  const started = child?.createdAt;
  const elapsed =
    child && started && !running && child.updatedAt > started
      ? duration(child.updatedAt - started)
      : undefined;
  const result = child?.messages.filter((item) => item.role === 'assistant').at(-1)?.text;
  const stateLabel = child
    ? WORKER_STATUS[child.status][0]
    : tool.status === 'declined'
      ? 'Declined'
      : tool.status === 'failed'
        ? 'Failed'
        : tool.status === 'running'
          ? 'Starting'
          : 'Ran';
  return (
    <div className={`subagent ${child?.status ?? ''}`}>
      <div className="subagent-header">
        <button
          type="button"
          className="subagent-toggle"
          aria-expanded={open}
          disabled={!child}
          onClick={() => setOverride(!open)}
        >
          <Chevron open={open} />
          {child ? <AgentMark agent={agentKind(child)} /> : <Icon name="agent" size={13} />}
          <span className="step-text">
            <span className="step-verb">
              {stateLabel} {agentName}
            </span>{' '}
            <span>{child?.title ?? tool.title}</span>
          </span>
        </button>
        {child?.activeModel || child?.model ? (
          <span className="badge">{child.model ?? child.activeModel}</span>
        ) : null}
        {elapsed ? <span className="step-meta">{elapsed}</span> : null}
        {running ? <span className="spinner" role="img" aria-label="Running" /> : null}
        {child ? (
          <button
            type="button"
            className="text-action"
            aria-label={`Open thread: ${child.title}`}
            onClick={() => onOpen(child)}
          >
            Open
          </button>
        ) : null}
      </div>
      {child?.approval && !isQuestion(child.approval) ? (
        <ApprovalForm approval={child.approval} sessionId={child.id} />
      ) : null}
      {open && child ? <ChildTranscript session={child} /> : null}
      {!open && child && result ? (
        <div className="subagent-result markdown">
          <MarkdownText text={result} />
        </div>
      ) : null}
      {child?.status === 'completed' && result && tool.name === 'delegate' ? (
        <button
          type="button"
          className="text-action use-result"
          disabled={parent.status === 'running' || parent.status === 'waiting'}
          onClick={() => onUseResult(`${AGENT_LABELS[agentKind(child)]} replied:\n\n${result}\n\n`)}
        >
          Add this result to your next message
        </button>
      ) : null}
    </div>
  );
}
const MessageRow = memo(function MessageRow({
  message,
  streaming,
}: {
  message: Message;
  streaming?: boolean;
}) {
  const { role, text } = message;
  if (role === 'notice') return <output className="notice">{text}</output>;
  if (role === 'image' && message.image) return <ImageMessage image={message.image} />;
  if (role === 'user')
    return (
      <article className="message user">
        {message.attachments?.length ? (
          <div className="attachment-row">
            {message.attachments.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's attachments never change
              <AttachmentChip key={index} attachment={item} />
            ))}
          </div>
        ) : null}
        <div className="markdown">
          <MarkdownText text={text} />
        </div>
      </article>
    );
  return (
    <article className="message assistant">
      <div className="markdown">
        <MarkdownText text={text} streaming={streaming} />
      </div>
    </article>
  );
});
export function ApprovalForm({ approval, sessionId }: { approval: Approval; sessionId: string }) {
  const respond = (allowed: boolean) =>
    send({ type: 'approve', id: sessionId, requestId: approval.id, allowed, answers: {} });
  return (
    <section className="approval" aria-label="Agent request">
      <h2>
        <span className="status-dot waiting" />
        {approval.title}
      </h2>
      {approval.diffs?.map((diff) => (
        <DiffCard key={diff.path} diff={diff} />
      ))}
      {approval.detail ? <pre>{approval.detail}</pre> : null}
      <div className="approval-actions">
        <button type="button" onClick={() => respond(false)}>
          Decline
        </button>
        <button type="button" className="primary" onClick={() => respond(true)}>
          Allow once
        </button>
      </div>
    </section>
  );
}
type Segment =
  | { type: 'message'; message: Message }
  | { type: 'activity'; items: Message[] }
  | { type: 'subagent'; message: Message };
function isSubagent(message: Message): boolean {
  return (
    message.tool?.kind === 'agent' &&
    ['delegate', 'run_agent', 'spawnAgent', 'Task', 'Agent'].includes(message.tool.name)
  );
}
export function segment(messages: Message[]): Segment[] {
  const segments: Segment[] = [];
  for (const message of messages) {
    if (isSubagent(message)) segments.push({ type: 'subagent', message });
    else if (message.role === 'tool' || message.role === 'thinking') {
      const last = segments.at(-1);
      if (last?.type === 'activity') last.items.push(message);
      else segments.push({ type: 'activity', items: [message] });
    } else segments.push({ type: 'message', message });
  }
  return segments;
}
function findChild(message: Message, parent: Session, sessions: Session[]): Session | undefined {
  const id = message.tool?.workerId ?? message.id;
  return sessions.find(
    (item) => item.parentId === parent.id && (item.id === id || item.nativeId === id),
  );
}
export function Conversation({
  session,
  sessions,
  scroll,
  onScroll,
  onOpenThread,
  onUseResult,
  onKeepPlanning,
}: {
  session: Session;
  sessions: Session[];
  scroll: Record<string, number>;
  onScroll: (id: string, top: number) => void;
  onOpenThread: (session: Session) => void;
  onUseResult: (text: string) => void;
  onKeepPlanning: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const previousSession = useRef('');
  const [limit, setLimit] = useState(100);
  const [showJump, setShowJump] = useState(false);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    if (previousSession.current !== session.id) {
      previousSession.current = session.id;
      element.scrollTop = scroll[session.id] ?? element.scrollHeight;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
    setShowJump(!follow.current);
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: each thread pages its own history
  useEffect(() => setLimit(100), [session.id]);
  const visible = session.messages.slice(-limit);
  const segments = segment(visible);
  const running = session.status === 'running';
  const lastIndex = segments.length - 1;
  const lastIsActivity = segments[lastIndex]?.type === 'activity';
  const childApprovals = sessions.filter(
    (item) =>
      item.parentId === session.id &&
      item.approval &&
      !isQuestion(item.approval) &&
      // Cards already show their child's request; this catches workers with no card in view.
      !visible.some((message) => findChild(message, session, sessions)?.id === item.id),
  );
  return (
    <div className="conversation-wrap">
      {/* A thread's plan stays above the messages rather than scrolling away with them. */}
      <PlanCard key={session.id} session={session} onKeepPlanning={onKeepPlanning} />
      <div
        className="conversation"
        ref={container}
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          setShowJump(!follow.current);
          onScroll(session.id, element.scrollTop);
        }}
      >
        <div className="transcript">
          {session.messages.length > limit ? (
            <button
              type="button"
              className="load-earlier"
              onClick={() => {
                const element = container.current;
                const height = element?.scrollHeight ?? 0;
                follow.current = false;
                setLimit((value) => value + 100);
                requestAnimationFrame(() => {
                  if (element) element.scrollTop += element.scrollHeight - height;
                });
              }}
            >
              Load earlier messages ({session.messages.length - limit})
            </button>
          ) : null}
          {!session.messages.length ? (
            <div className="session-empty">
              <p>
                {agentLabel(session)} will work in <code>{session.cwd}</code>.
              </p>
            </div>
          ) : null}
          {segments.map((item, index) => {
            if (item.type === 'activity')
              return (
                <ActivityGroup
                  key={item.items[0].id}
                  items={item.items}
                  active={running && index === lastIndex}
                  sessionId={session.id}
                />
              );
            if (item.type === 'subagent')
              return (
                <SubagentCard
                  key={item.message.id}
                  message={item.message}
                  child={findChild(item.message, session, sessions)}
                  parent={session}
                  onOpen={onOpenThread}
                  onUseResult={onUseResult}
                />
              );
            return (
              <MessageRow
                key={item.message.id}
                message={item.message}
                streaming={running && index === lastIndex}
              />
            );
          })}
          {session.approval && session.approval.kind !== 'plan' && !isQuestion(session.approval) ? (
            <ApprovalForm
              key={session.approval.id}
              approval={session.approval}
              sessionId={session.id}
            />
          ) : null}
          {childApprovals.map((child) =>
            child.approval ? (
              <ApprovalForm
                key={child.approval.id}
                approval={child.approval}
                sessionId={child.id}
              />
            ) : null,
          )}
          {running && !lastIsActivity ? (
            <output className="working">
              <span className="spinner" />
              <span className="shimmer">Working…</span>
            </output>
          ) : null}
        </div>
      </div>
      {showJump ? (
        <button
          type="button"
          className="jump"
          onClick={() => {
            follow.current = true;
            container.current?.scrollTo({
              top: container.current.scrollHeight,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
            });
          }}
        >
          Jump to latest ↓
        </button>
      ) : null}
    </div>
  );
}
