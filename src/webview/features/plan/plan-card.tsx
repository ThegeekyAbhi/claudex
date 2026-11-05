import {
  agentKind,
  type BuildChoice,
  planSummary,
  planTitle,
  type Session,
} from '../../../core/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { ACTIVITY_LABELS, mascotActivity } from '../mascot/activity';
import { Mascot } from '../mascot/mascot';
import { BuildButton } from './build-button';

const NOTE = {
  incomplete: 'The turn ended before this plan was finished',
  approved: 'Build started',
} as const;
/** The plan in the transcript. Reading and editing it happens in the editor, in the center. */
export function PlanCard({ session }: { session: Session }) {
  const plan = session.plan;
  const build = (choice: BuildChoice) => send({ type: 'buildPlan', id: session.id, ...choice });
  const pending = session.approval?.kind === 'plan';
  const busy = (session.status === 'running' || session.status === 'waiting') && !pending;
  const offered = plan?.status === 'ready' || plan?.status === 'incomplete';
  const activity = mascotActivity(session);
  if (!plan) return null;
  if (plan.status === 'drafting')
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Mascot activity={activity ?? 'attentive'} />
        <span>{activity ? ACTIVITY_LABELS[activity] : 'Plan unfinished'}</span>
      </div>
    );
  const summary = planSummary(plan.text);
  const note = plan.status === 'incomplete' || plan.status === 'approved' ? NOTE[plan.status] : '';
  return (
    <section
      aria-label="Created plan"
      className="my-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] p-2.5"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon name="plan" size={12} />
        <span>Created plan</span>
        {note ? <span>· {note}</span> : null}
      </div>
      <h3 className="m-0 truncate text-[13px] font-semibold text-foreground">
        {planTitle(plan.text, session.title)}
      </h3>
      {summary && plan.status !== 'approved' ? (
        <p className="m-0 mt-1 line-clamp-3 text-xs leading-[1.5] text-muted-foreground">
          {summary}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {plan.file ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 cursor-pointer px-2 text-xs"
            onClick={() => send({ type: 'viewPlan', id: session.id })}
          >
            View Plan
          </Button>
        ) : null}
        {offered ? (
          <BuildButton agent={agentKind(session)} disabled={busy} onBuild={build} />
        ) : null}
      </div>
    </section>
  );
}
