import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AGENT_LABELS,
  type Approval,
  agentKind,
  agentLabel,
  type FileDiff,
  type Message,
  type Session,
  type ToolInfo,
} from '../../../core/model';
import { EXPLAIN_GUIDE } from '../../../harness/explain-guidance';
import { PLANNING_GUIDE } from '../../../harness/planning-guidance';
import { send } from '../../app/bridge';
import { AgentMark, Icon, type IconName } from '../../components/icons';
import { AutoHelp } from '../../components/menus';
import { MarkdownText } from '../../lib/markdown';
import { AttachmentChip } from '../attachments/context-menu';
import { DiffCard, DiffStat } from '../changes/diff-view';
import { ImageMessage } from '../images/image-view';
import { ACTIVITY_LABELS, type MascotActivity, mascotActivity } from '../mascot/activity';
import { Mascot } from '../mascot/mascot';
import { PlanCard } from '../plan/plan-card';
import { isQuestion } from '../questions/question-card';

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-flex text-muted-foreground transition-transform duration-[120ms] ease-[ease] [&.open]:rotate-90 motion-reduce:transition-none ${open ? 'open' : ''}`}
    >
      <Icon name="chevron" size={11} />
    </span>
  );
}
function StepState({ status }: { status: ToolInfo['status'] }) {
  if (status === 'running')
    return (
      <span
        className="spinner size-[11px] shrink-0 inline-block rounded-full border-[1.5px] border-strong border-t-foreground animate-spinner motion-reduce:animate-none"
        role="img"
        aria-label="Running"
      />
    );
  if (status === 'failed')
    return (
      <span
        className="inline-flex shrink-0 [&.done]:text-success [&.failed]:text-error [&.declined]:text-warning failed"
        role="img"
        aria-label="Failed"
      >
        <Icon name="x" size={12} />
      </span>
    );
  if (status === 'interrupted')
    return (
      <span role="img" aria-label="Interrupted" className="text-warning">
        <Icon name="stop" size={12} />
      </span>
    );
  if (status === 'declined')
    return (
      <span
        className="inline-flex shrink-0 [&.done]:text-success [&.failed]:text-error [&.declined]:text-warning declined"
        role="img"
        aria-label="Declined"
      >
        <Icon name="x" size={12} />
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 [&.done]:text-success [&.failed]:text-error [&.declined]:text-warning done"
      role="img"
      aria-label="Done"
    >
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
  skill: ['Invoking skill', 'Used skill'],
  other: ['Calling', 'Called'],
};
const ICONS: Record<ToolInfo['kind'], IconName> = {
  command: 'terminal',
  read: 'read',
  edit: 'edit',
  search: 'search',
  web: 'globe',
  agent: 'agent',
  skill: 'skill',
  other: 'wrench',
};
function verb(tool: ToolInfo): string {
  const [running, done] =
    tool.skill?.phase === 'read' ? ['Reading skill', 'Read skill'] : VERBS[tool.kind];
  if (tool.status === 'interrupted') return 'Interrupted:';
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
      <span className="flex-1 min-w-0 truncate">
        <span className="text-foreground">{verb(tool)}</span>{' '}
        {code ? <code>{tool.title}</code> : <span>{tool.title}</span>}
      </span>
      {tool.durationMs !== undefined && tool.durationMs >= 1000 ? (
        <span className="text-[10.5px] text-muted-foreground shrink-0">
          {duration(tool.durationMs)}
        </span>
      ) : null}
      {tool.exitCode !== undefined && tool.exitCode !== 0 ? (
        <span
          className="text-[10.5px] text-error shrink-0 tabular-nums"
          title="Exit code, as the CLI reported it"
        >
          exit {tool.exitCode}
        </span>
      ) : null}
      <StepState status={tool.status} />
    </>
  );
  if (!detail)
    return (
      <div className="flex items-center gap-[7px] w-full min-h-6 px-1.5 py-0.5 text-[12px] text-muted-foreground rounded-sm text-left justify-start [&.interactive]:enabled:hover:text-foreground">
        {body}
      </div>
    );
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex items-center gap-[7px] w-full min-h-6 px-1.5 py-0.5 text-[12px] text-muted-foreground rounded-sm text-left justify-start [&.interactive]:enabled:hover:text-foreground interactive"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {body}
        <Chevron open={open} />
      </button>
      {open ? (
        <pre className="border border-subtle bg-surface px-3 py-2.5 overflow-auto rounded-md font-mono text-[11.5px] leading-[1.55] max-h-[360px] mt-0.5 mr-0 mb-1.5 ml-1.5 whitespace-pre-wrap wrap-anywhere">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}
function LegacyTool({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex items-center gap-[7px] w-full min-h-6 px-1.5 py-0.5 text-[12px] text-muted-foreground rounded-sm text-left justify-start [&.interactive]:enabled:hover:text-foreground interactive"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="terminal" size={13} />
        <span className="flex-1 min-w-0 truncate">
          {text.split('\n')[0].slice(0, 160) || 'Tool activity'}
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <pre className="border border-subtle bg-surface px-3 py-2.5 overflow-auto rounded-md font-mono text-[11.5px] leading-[1.55] max-h-[360px] mt-0.5 mr-0 mb-1.5 ml-1.5 whitespace-pre-wrap wrap-anywhere">
          {text}
        </pre>
      ) : null}
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
    <div className="min-w-0">
      <button
        type="button"
        className="flex items-center gap-[7px] w-full min-h-6 px-1.5 py-0.5 text-[12px] text-muted-foreground rounded-sm text-left justify-start [&.interactive]:enabled:hover:text-foreground interactive reasoning-toggle"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
      >
        <Icon name="brain" size={13} />
        <span className={`flex-1 min-w-0 truncate ${streaming ? 'shimmer' : ''}`}>
          {streaming ? 'Thinking…' : seconds ? `Thought for ${seconds}` : 'Thought'}
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="mt-0.5 mr-0 mb-2 ml-1.5 pl-2.5 [border-left:1px_dashed_var(--border-strong)] text-muted-foreground text-[12px] markdown">
          <MarkdownText text={message.text} streaming={streaming} />
        </div>
      ) : null}
    </div>
  );
}
function activitySummary(items: Message[]): string {
  const count = (kind: ToolInfo['kind']) =>
    items.filter((m) => m.tool?.kind === kind && !m.tool.diffSource).length;
  const plural = (value: number, noun: string, many = `${noun}s`) =>
    `${value} ${value === 1 ? noun : many}`;
  const parts: string[] = [];
  if (count('edit')) parts.push(`edited ${plural(count('edit'), 'file')}`);
  if (count('command')) parts.push(`ran ${plural(count('command'), 'command')}`);
  if (count('read')) parts.push(`read ${plural(count('read'), 'file')}`);
  if (count('search')) parts.push(`ran ${plural(count('search'), 'search', 'searches')}`);
  if (count('web')) parts.push(`fetched ${plural(count('web'), 'page')}`);
  if (count('skill')) parts.push(`invoked ${plural(count('skill'), 'skill')}`);
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
    message.tool?.status === 'declined' ||
    message.tool?.status === 'failed' ||
    message.tool?.status === 'interrupted'
      ? []
      : (message.tool?.diffs ?? []),
  );
}
function ActivityGroup({
  items,
  active,
  sessionId,
  activeLabel = 'Working…',
  activity,
}: {
  items: Message[];
  activeLabel?: string;
  activity?: MascotActivity;
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
    <div className="my-2">
      <button
        type="button"
        className="gap-[5px] py-[3px] pr-1.5 pl-0.5 text-[12px] text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-transparent"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
      >
        <Chevron open={open} />
        {active && activity ? <Mascot activity={activity} /> : null}
        <span className={active ? 'shimmer' : ''}>
          {active ? activeLabel : activitySummary(items)}
        </span>
        {failed ? <span className="text-error">with failures</span> : null}
        {diffs.length ? <DiffStat {...totals} /> : null}
      </button>
      {open ? (
        <div className="mt-0.5 mr-0 mb-1.5 ml-[7px] pl-2.5 border-l border-strong">
          {items.map((message) =>
            message.role === 'thinking' ? (
              <Reasoning key={message.id} message={message} active={active} />
            ) : message.tool?.diffSource ? null : message.tool ? (
              <ToolStep key={message.id} message={message} />
            ) : (
              <LegacyTool key={message.id} text={message.text} />
            ),
          )}
        </div>
      ) : null}
      {/* Diffs stay visible when the steps above are collapsed. */}
      {items.map((message) => (
        <div key={message.id}>
          {message.tool?.captureNote ? (
            <p className="my-1 text-[11px] text-muted-foreground">{message.tool.captureNote}</p>
          ) : null}
          {diffsOf([message]).map((diff, index) => (
            <DiffCard key={`${diff.path}-${index}`} diff={diff} sessionId={sessionId} />
          ))}
        </div>
      ))}
    </div>
  );
}
function ChildTranscript({ session }: { session: Session }) {
  const segments = segment(session.messages);
  const activity = mascotActivity(session);
  return (
    <div className="subagent-transcript m-0 pt-1.5 px-3 pb-2 border-t border-subtle">
      {segments.map((item, index) =>
        item.type === 'activity' ? (
          <ActivityGroup
            key={item.items[0].id}
            items={item.items}
            active={
              session.status === 'running' && index === segments.length - 1 && Boolean(activity)
            }
            activity={activity}
            activeLabel={ACTIVITY_LABELS[activity ?? 'working']}
            sessionId={session.id}
          />
        ) : item.message.role === 'user' ? null : (
          <MessageRow key={item.message.id} message={item.message} />
        ),
      )}
      {!session.messages.length ? (
        <p className="text-muted-foreground my-1 text-[12px]">
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
  // The child's own record of what it received. Long threads send only their tail here.
  const sentMessage = child?.messages.find((item) => item.role === 'user');
  const sentText =
    sentMessage?.text ?? (tool.name !== 'Task' && tool.name !== 'Agent' ? tool.input : undefined);
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
    <div
      className={`subagent my-2.5 border border-subtle border-l-2 border-l-strong rounded-md bg-surface [&.running]:border-l-foreground [&.waiting]:border-l-warning [&.failed]:border-l-error ${child?.status ?? ''}`}
    >
      <div className="flex items-center gap-1.5 py-[3px] pr-1.5 pl-0.5">
        <button
          type="button"
          className="flex-1 min-w-0 justify-start gap-1.5 px-1 py-[3px] text-[12px] text-muted-foreground text-left disabled:opacity-100"
          aria-expanded={open}
          disabled={!child}
          onClick={() => setOverride(!open)}
        >
          <Chevron open={open} />
          {child ? <AgentMark agent={agentKind(child)} /> : <Icon name="agent" size={13} />}
          <span className="flex-1 min-w-0 truncate">
            <span className="text-foreground">
              {stateLabel} {agentName}
            </span>{' '}
            <span>{child?.title ?? tool.title}</span>
          </span>
        </button>
        {child?.activeModel || child?.model ? (
          <span className="font-mono text-[10px] text-muted-foreground border border-subtle rounded-[3px] px-[5px] max-w-[130px] truncate shrink">
            {child.model ?? child.activeModel}
          </span>
        ) : null}
        {elapsed ? (
          <span className="text-[10.5px] text-muted-foreground shrink-0">{elapsed}</span>
        ) : null}
        {running ? (
          <span
            className="spinner size-[11px] shrink-0 inline-block rounded-full border-[1.5px] border-strong border-t-foreground animate-spinner motion-reduce:animate-none"
            role="img"
            aria-label="Running"
          />
        ) : null}
        {child ? (
          <button
            type="button"
            className="px-1.5 py-0.5 text-[11px] text-muted-foreground shrink-0 enabled:hover:text-foreground in-[.changes-summary]:ml-auto"
            aria-label={`Open thread: ${child.title}`}
            onClick={() => onOpen(child)}
          >
            Open
          </button>
        ) : null}
      </div>
      {sentText ? (
        <SentPrompt
          asker={tool.name === 'delegate' ? 'You' : agentLabel(parent)}
          agentName={agentName}
          text={sentText}
          message={sentMessage}
        />
      ) : null}
      {child?.approval && !isQuestion(child.approval) ? (
        <ApprovalForm approval={child.approval} sessionId={child.id} session={child} />
      ) : null}
      {open && child ? <ChildTranscript session={child} /> : null}
      {!open && child && result ? (
        <div className="m-0 pt-1.5 px-3 pb-2 border-t border-subtle text-[12px] max-h-[200px] overflow-y-auto markdown">
          <MarkdownText text={result} />
        </div>
      ) : null}
      {child?.status === 'completed' && result && tool.name === 'delegate' ? (
        <button
          type="button"
          className="px-1.5 py-0.5 text-[11px] text-muted-foreground shrink-0 enabled:hover:text-foreground in-[.changes-summary]:ml-auto mx-1.5 mb-1.5 mt-0"
          disabled={parent.status === 'running' || parent.status === 'waiting'}
          onClick={() => onUseResult(`${AGENT_LABELS[agentKind(child)]} replied:\n\n${result}\n\n`)}
        >
          Add this result to your next message
        </button>
      ) : null}
    </div>
  );
}
/** What a guide added to a message beyond your words. */
function GuideDisclosures({ message }: { message: Message }) {
  return (
    <>
      {message.planningGuideVersion ? (
        <details className="mt-1 text-[11px] text-muted-foreground">
          <summary>Planning guide v{message.planningGuideVersion}</summary>
          <div className="markdown">
            <MarkdownText text={PLANNING_GUIDE.replace(/<[^>]+>/g, '')} />
          </div>
        </details>
      ) : null}
      {message.explainGuideVersion ? (
        <details className="mt-1 text-[11px] text-muted-foreground">
          <summary>Explanation guide v{message.explainGuideVersion}</summary>
          <div className="markdown">
            <MarkdownText text={EXPLAIN_GUIDE.replace(/<[^>]+>/g, '')} />
          </div>
        </details>
      ) : null}
    </>
  );
}
/** Who asked the agent on this card, and in exactly what words. */
function SentPrompt({
  asker,
  agentName,
  text,
  message,
}: {
  asker: string;
  agentName: string;
  text: string;
  message?: Message;
}) {
  const [all, setAll] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 3;
  return (
    <div className="sent-prompt pt-1.5 px-3 pb-2 border-t border-subtle text-[12px]">
      <div className="text-[11px] text-muted-foreground mb-0.5">
        {asker} asked {agentName}
      </div>
      {message?.attachments?.length ? (
        <div className="flex flex-wrap items-start gap-1 pb-1">
          {message.attachments.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's attachments never change
            <AttachmentChip key={index} attachment={item} />
          ))}
        </div>
      ) : null}
      <div className={`whitespace-pre-wrap wrap-anywhere ${long && !all ? 'line-clamp-3' : ''}`}>
        {text}
      </div>
      {long ? (
        <button
          type="button"
          className="mt-0.5 p-0 text-[11px] text-muted-foreground enabled:hover:text-foreground"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      ) : null}
      {message ? <GuideDisclosures message={message} /> : null}
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
  if (role === 'notice')
    return (
      <output className="block text-[12px] bg-surface wrap-anywhere border border-subtle rounded-md my-2.5 px-3 py-2 text-muted-foreground">
        {text}
      </output>
    );
  if (role === 'image' && message.image) return <ImageMessage image={message.image} />;
  if (role === 'user')
    return (
      <article className="my-3.5 [&.user]:bg-raised [&.user]:border [&.user]:border-subtle [&.user]:rounded-[8px] [&.user]:px-3 [&.user]:py-2 [&.user]:mt-6 [&.user]:first:mt-0 in-[.subagent-transcript]:my-2 in-[.subagent-transcript]:text-[12px] user">
        {message.attachments?.length ? (
          <div className="flex flex-wrap items-start gap-1 pt-2 px-2.5 pb-0 in-[.user]:pt-0 in-[.user]:px-0 in-[.user]:pb-1.5">
            {message.attachments.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's attachments never change
              <AttachmentChip key={index} attachment={item} />
            ))}
          </div>
        ) : null}
        <div className="markdown">
          <MarkdownText text={text} />
        </div>
        <GuideDisclosures message={message} />
      </article>
    );
  return (
    <article className="my-3.5 [&.user]:bg-raised [&.user]:border [&.user]:border-subtle [&.user]:rounded-[8px] [&.user]:px-3 [&.user]:py-2 [&.user]:mt-6 [&.user]:first:mt-0 in-[.subagent-transcript]:my-2 in-[.subagent-transcript]:text-[12px] assistant">
      <div className="markdown">
        <MarkdownText text={text} streaming={streaming} />
      </div>
    </article>
  );
});
export function ApprovalForm({
  approval,
  sessionId,
  session,
}: {
  approval: Approval;
  sessionId: string;
  session?: Session;
}) {
  const transitioning = Boolean(session?.transition);
  // Already in Auto, this would be the same as Allow once.
  const eligible =
    session?.mode !== 'auto' &&
    approval.origin === 'provider' &&
    !approval.questions &&
    !approval.kind &&
    session?.nativeId &&
    !session.observed &&
    (session.provider !== 'codex' || session.nativeSettings?.approvalPolicy === 'on-request');
  const respond = (allowed: boolean) =>
    send({ type: 'approve', id: sessionId, requestId: approval.id, allowed, answers: {} });
  return (
    <section
      className="border border-strong rounded-lg bg-raised my-3.5 px-3 py-2.5 in-[.subagent]:mx-2 in-[.subagent]:mt-0 in-[.subagent]:mb-2 [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-[12.5px] [&_h2]:font-medium [&_h2]:mt-0 [&_h2]:mx-0 [&_h2]:mb-2 [&_pre]:border [&_pre]:border-subtle [&_pre]:bg-surface [&_pre]:px-3 [&_pre]:py-2.5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:font-mono [&_pre]:text-[11.5px] [&_pre]:leading-[1.55] [&_pre]:max-h-[200px] [&_pre]:my-2 [&_pre]:mx-0 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere"
      aria-label="Agent request"
    >
      <h2>
        <span className="status-dot size-1.5 rounded-full bg-muted-foreground shrink-0 inline-block [&.quiet]:bg-faint [&.quiet]:opacity-50 [&.waiting]:bg-warning [&.failed]:bg-error in-[.rail-item]:ml-auto waiting" />
        {approval.title}
      </h2>
      {approval.diffs?.map((diff) => (
        <DiffCard key={diff.path} diff={diff} />
      ))}
      {approval.detail ? <pre>{approval.detail}</pre> : null}
      {session?.transition ? (
        <output>{session.transition === 'stopping' ? 'Stopping…' : 'Resuming in Auto…'}</output>
      ) : null}
      <div className="flex flex-wrap justify-end gap-1.5 mt-2.5 [&>button]:border-strong [&>button]:px-3 [&>button]:py-1 [&>button]:text-[12px]">
        <button type="button" disabled={transitioning} onClick={() => respond(false)}>
          Decline
        </button>
        <button
          type="button"
          className="bg-primary text-primary-foreground enabled:hover:bg-accent-hover"
          disabled={transitioning}
          onClick={() => respond(true)}
        >
          Allow once
        </button>
        {eligible ? (
          <>
            <button
              type="button"
              className="bg-mode-auto text-mode-auto-foreground enabled:hover:opacity-90"
              disabled={transitioning}
              onClick={() =>
                send({
                  type: 'approve',
                  id: sessionId,
                  requestId: approval.id,
                  allowed: true,
                  auto: true,
                  answers: {},
                })
              }
            >
              <Icon name="autoMode" size={13} /> Allow in Auto
            </button>
            <AutoHelp
              text={
                session?.provider === 'codex'
                  ? 'Allows this request, then uses Codex Auto review from its next turn. Until then it may still ask.'
                  : 'Allows this request, then Claude Code Auto mode reviews what comes next and asks only when it needs to.'
              }
            />
          </>
        ) : null}
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
    // Observations remain in session history, but do not add duplicate change cards to chat.
    if (message.tool?.diffSource) continue;
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
function segmentKey(item: ReturnType<typeof segment>[number]): string {
  return item.type === 'activity' ? item.items[0].id : item.message.id;
}
function segmentHas(item: ReturnType<typeof segment>[number], id: string | undefined): boolean {
  if (!id) return false;
  return item.type === 'activity'
    ? item.items.some((message) => message.id === id)
    : item.message.id === id;
}
export function Conversation({
  session,
  sessions,
  scroll,
  onScroll,
  onOpenThread,
  onUseResult,
}: {
  session: Session;
  sessions: Session[];
  scroll: Record<string, number>;
  onScroll: (id: string, top: number) => void;
  onOpenThread: (session: Session) => void;
  onUseResult: (text: string) => void;
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
  const activity = mascotActivity(session);
  const lastIndex = segments.length - 1;
  // After the message it followed, so what you build from it reads below it.
  const planIndex = segments.findIndex((item) => segmentHas(item, session.plan?.after));
  const planCard = session.plan ? <PlanCard session={session} /> : null;
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
    <div className="flex-1 min-h-0 relative flex flex-col">
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-4 px-6 pb-6 [scrollbar-gutter:stable] max-[900px]:pt-3 max-[900px]:px-4 max-[900px]:pb-4"
        ref={container}
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          setShowJump(!follow.current);
          onScroll(session.id, element.scrollTop);
        }}
      >
        <div className="max-w-[780px] m-auto">
          {session.messages.length > limit ? (
            <button
              type="button"
              className="w-full text-muted-foreground text-[12px] mb-2"
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
            <div className="session-empty py-8 text-muted-foreground text-[12px] wrap-anywhere">
              <p>
                {agentLabel(session)} will work in <code>{session.cwd}</code>.
              </p>
            </div>
          ) : null}
          {segments.map((item, index) => {
            const row = (() => {
              if (item.type === 'activity')
                return (
                  <ActivityGroup
                    key={item.items[0].id}
                    items={item.items}
                    active={
                      running &&
                      index === lastIndex &&
                      session.plan?.status !== 'drafting' &&
                      Boolean(activity) &&
                      activity !== 'attentive'
                    }
                    activity={activity}
                    activeLabel={ACTIVITY_LABELS[activity ?? 'working']}
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
            })();
            return index === planIndex ? (
              <Fragment key={segmentKey(item)}>
                {row}
                {planCard}
              </Fragment>
            ) : (
              row
            );
          })}
          {planIndex === -1 ? planCard : null}
          {session.transition && !session.approval ? (
            <output className="text-muted-foreground">
              {session.transition === 'stopping' ? 'Stopping…' : 'Resuming in Auto…'}
            </output>
          ) : null}
          {session.approval && session.approval.kind !== 'plan' && !isQuestion(session.approval) ? (
            <ApprovalForm
              key={session.approval.id}
              approval={session.approval}
              sessionId={session.id}
              session={session}
            />
          ) : null}
          {childApprovals.map((child) =>
            child.approval ? (
              <ApprovalForm
                key={child.approval.id}
                approval={child.approval}
                sessionId={child.id}
                session={child}
              />
            ) : null,
          )}
          {activity &&
          (activity === 'attentive' || !lastIsActivity) &&
          session.plan?.status !== 'drafting' &&
          !session.transition ? (
            <output className="flex items-center gap-2 text-muted-foreground text-[12px] my-3">
              <Mascot activity={activity} />
              <span>{ACTIVITY_LABELS[activity]}</span>
            </output>
          ) : null}
        </div>
      </div>
      {showJump ? (
        <button
          type="button"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-raised border-strong text-[11px] px-2.5 py-[3px] enabled:hover:bg-accent"
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
