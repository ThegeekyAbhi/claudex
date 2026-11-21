import { useCallback, useState } from 'react';
import { agentLabel, type Session } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon, type IconName } from '../../components/icons';
import { MarkdownText } from '../../lib/markdown';
import { ACTIVITY_LABELS, mascotActivity } from '../mascot/activity';
import { Mascot } from '../mascot/mascot';

const STATUS = {
  ready: 'Ready for you',
  incomplete: 'Unfinished: the turn ended first',
  approved: 'Implementation requested',
} as const;
/** Taller than this, a plan starts folded so the conversation stays in view. */
const CLAMP = 420;

function HeaderAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="grid size-6 place-items-center rounded text-muted-foreground enabled:hover:bg-raised enabled:hover:text-foreground"
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

/** The plan in the transcript, readable in place, with your answer to it underneath. */
export function PlanCard({
  session,
  startOpen,
}: {
  session: Session;
  /** Shown on request (from the header), so it opens rather than starting folded. */
  startOpen?: boolean;
}) {
  const plan = session.plan;
  const activity = mascotActivity(session);
  const [tall, setTall] = useState(false);
  // Open once you open it; an implemented plan starts folded, since its work follows.
  const [open, setOpen] = useState<boolean | null>(startOpen ? true : null);
  const [copied, setCopied] = useState(false);
  const text = plan?.text ?? '';
  // Measured whenever the body mounts, which is once drafting ends.
  const body = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => setTall(element.scrollHeight > CLAMP + 40);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!plan) return null;
  if (plan.status === 'drafting')
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Mascot activity={activity ?? 'attentive'} />
        <span>{activity ? ACTIVITY_LABELS[activity] : 'Plan unfinished'}</span>
      </div>
    );
  const approved = plan.status === 'approved';
  // A finished plan with a file opens as a page, so the transcript keeps one line for it.
  const asPage = plan.status === 'ready' && Boolean(plan.file) && !startOpen;
  const expanded = open ?? !(approved || asPage);
  const clamped = expanded && tall && open !== true;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be unavailable; the plan stays selectable.
    }
  }
  // Folded to one quiet line: built plans, so the work that follows reads without them in the
  // way, and plans that open as a page.
  if (!expanded && (approved || asPage))
    return (
      <div className="plan-card plan-folded my-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Icon name="plan" size={13} />
        <span className="truncate">
          Plan · {agentLabel(session)} ·{' '}
          <span
            className={
              plan.status === 'ready'
                ? 'text-success'
                : plan.status === 'incomplete'
                  ? 'text-warning'
                  : ''
            }
          >
            {approved ? 'built' : STATUS[plan.status]}
          </span>
        </span>
        {plan.file ? (
          <button
            type="button"
            className="gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-foreground enabled:hover:bg-raised"
            onClick={() => send({ type: 'viewPlan', id: session.id })}
          >
            <Icon name="page" size={12} />
            Open in page
          </button>
        ) : null}
        <button
          type="button"
          className="gap-1 px-1 py-0.5 text-[11.5px] text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-transparent"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Show plan
          <Icon name="chevronDown" size={12} />
        </button>
      </div>
    );
  return (
    <section
      aria-label="Plan"
      className="plan-card my-3 rounded-lg border border-strong bg-surface"
    >
      <header className="flex items-center gap-1.5 border-b border-subtle py-1.5 pr-1.5 pl-3 text-[11.5px] text-muted-foreground">
        <Icon name="plan" size={13} />
        <span className="font-medium text-foreground">Plan</span>
        <span>· {agentLabel(session)}</span>
        <span
          className={`truncate ${plan.status === 'ready' ? 'text-success' : plan.status === 'incomplete' ? 'text-warning' : ''}`}
        >
          · {STATUS[plan.status]}
        </span>
        <span className="ml-auto flex shrink-0 items-center">
          <HeaderAction
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied' : 'Copy plan'}
            onClick={copy}
          />
          {plan.file ? (
            <>
              <HeaderAction
                icon="edit"
                label="Edit plan"
                onClick={() => send({ type: 'editPlan', id: session.id })}
              />
              <HeaderAction
                icon="external"
                label="Open plan"
                onClick={() => send({ type: 'viewPlan', id: session.id })}
              />
            </>
          ) : null}
        </span>
      </header>
      <div className="relative">
        <div
          ref={body}
          // Positioned, so the clamp also clips absolutely placed descendants (such as a code
          // block's screen-reader status); otherwise they escape and stretch the transcript.
          className={`plan-body markdown reply relative px-4 pt-2 pb-3 ${expanded ? '' : 'hidden'} ${clamped ? 'max-h-[420px] overflow-clip' : ''}`}
        >
          <MarkdownText text={text} />
        </div>
        {clamped ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-[var(--surface)]" />
        ) : null}
      </div>
      {((tall || approved) && expanded) || !expanded ? (
        <div className={`flex px-3 ${expanded ? 'pb-2' : 'py-2'}`}>
          <button
            type="button"
            className="gap-1 px-1 py-0.5 text-[12px] text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-transparent"
            aria-expanded={expanded && !clamped}
            onClick={() => setOpen(!(expanded && !clamped))}
          >
            <Icon name={expanded && !clamped ? 'chevronUp' : 'chevronDown'} size={12} />
            {!expanded ? 'Show plan' : clamped ? 'Show full plan' : 'Show less'}
          </button>
        </div>
      ) : null}
      {plan.status === 'incomplete' ? (
        <div className="px-3 pb-3">
          <p className="m-0 mt-2 text-xs text-muted-foreground">
            Continue planning in the message box.
          </p>
        </div>
      ) : null}
    </section>
  );
}
