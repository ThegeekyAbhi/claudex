import { useState } from 'react';
import {
  agentKind,
  agentLabel,
  type Message,
  profileLabel,
  type Session,
  type ToolInfo,
} from '../../../shared/model';
import { AgentMark, Icon } from '../../components/icons';
import { MarkdownText } from '../../lib/markdown';
import { ACTIVITY_LABELS, mascotActivity } from '../mascot/activity';
import { isQuestion } from '../questions/question-card';
import { ActivityGroup } from './activity-group';
import { ApprovalForm } from './approval-form';
import { type Guides, MessageRow, SentPrompt } from './message-row';
import { Chevron } from './step-state';
import { duration, segment } from './view-model';

function ChildTranscript({ session, guides }: { session: Session; guides: Guides }) {
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
          <MessageRow key={item.message.id} message={item.message} guides={guides} />
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
export function SubagentCard({
  message,
  child,
  parent,
  onOpen,
  onUseResult,
  guides,
}: {
  message: Message;
  guides: Guides;
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
          guides={guides}
          asker={tool.name === 'delegate' ? 'You' : agentLabel(parent)}
          agentName={agentName}
          text={sentText}
          message={sentMessage}
        />
      ) : null}
      {child?.approval && !isQuestion(child.approval) ? (
        <ApprovalForm approval={child.approval} sessionId={child.id} session={child} />
      ) : null}
      {open && child ? <ChildTranscript session={child} guides={guides} /> : null}
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
          onClick={() => onUseResult(`${profileLabel(agentKind(child))} replied:\n\n${result}\n\n`)}
        >
          Add this result to your next message
        </button>
      ) : null}
    </div>
  );
}
