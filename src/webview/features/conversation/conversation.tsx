import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EXPLAIN_GUIDE } from '../../../shared/guidance/explain-guidance';
import { PLANNING_GUIDE } from '../../../shared/guidance/planning-guidance';
import { agentLabel, type Session } from '../../../shared/model';
import { ACTIVITY_LABELS, mascotActivity } from '../mascot/activity';
import { Mascot } from '../mascot/mascot';
import { PlanCard } from '../plan/plan-card';
import { isQuestion } from '../questions/question-card';
import { ActivityGroup } from './activity-group';
import { ApprovalForm } from './approval-form';
import { MessageRow } from './message-row';
import { SubagentCard } from './subagent-card';
import { TurnWork } from './turn-work';
import {
  findChild,
  noteIndices,
  segment,
  segmentHas,
  segmentKey,
  turns,
  workDuration,
  workMessages,
} from './view-model';

export { ApprovalForm } from './approval-form';
export { segment } from './view-model';

const guides = { planning: PLANNING_GUIDE, explain: EXPLAIN_GUIDE };
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

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
  /** Finished turns whose folded work you opened, by their first segment. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
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
  const live = running || session.status === 'waiting';
  const grouped = turns(segments, live);
  const notes = noteIndices(segments);
  const rowOf = (item: (typeof segments)[number], index: number) => {
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
          guides={guides}
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
        guides={guides}
        key={item.message.id}
        message={item.message}
        note={notes.has(index)}
        streaming={running && index === lastIndex}
      />
    );
  };
  /** One segment, with the plan card after the message it followed. */
  const at = (index: number) => {
    const item = segments[index];
    const row = rowOf(item, index);
    return index === planIndex ? (
      <Fragment key={segmentKey(item)}>
        {row}
        {planCard}
      </Fragment>
    ) : (
      row
    );
  };
  return (
    <div className="flex-1 min-h-0 relative flex flex-col">
      <div
        className="conversation-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-4 px-6 pb-6 [scrollbar-gutter:stable] max-[900px]:pt-3 max-[900px]:px-4 max-[900px]:pb-4"
        ref={container}
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          setShowJump(!follow.current);
          onScroll(session.id, element.scrollTop);
        }}
      >
        {/* Positioned, so nothing hidden inside can stretch the page past the conversation. */}
        <div className="relative max-w-[780px] m-auto">
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
          {grouped.map((turn) => {
            const indices = range(turn.start, turn.end);
            if (!turn.fold) return indices.map(at);
            const key = segmentKey(segments[turn.start]);
            const work = new Set(turn.work);
            const open = Boolean(opened[key]);
            const firstWork = turn.work[0] ?? turn.start;
            const workRows = workMessages(segments, turn.work);
            const answer = turn.answer !== undefined ? segments[turn.answer] : undefined;
            return (
              <Fragment key={`turn-${key}`}>
                {indices.filter((index) => index < firstWork).map(at)}
                <TurnWork
                  messages={workRows}
                  took={workDuration(
                    workRows,
                    answer?.type === 'message' ? answer.message : undefined,
                  )}
                  open={open}
                  onToggle={() => setOpened((all) => ({ ...all, [key]: !open }))}
                  sessionId={session.id}
                >
                  {turn.work.map(at)}
                </TurnWork>
                {indices.filter((index) => index > firstWork && !work.has(index)).map(at)}
                {/* A plan written during folded work shows after the turn, not inside the fold. */}
                {!open && work.has(planIndex) ? planCard : null}
              </Fragment>
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
          className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-1 rounded-full border border-subtle bg-overlay text-muted-foreground shadow-[var(--shadow)] text-[11px] px-3 py-1 enabled:hover:text-foreground"
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
