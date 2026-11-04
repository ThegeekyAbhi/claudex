import { useRef, useState } from 'react';
import type { Session } from '../model';
import { send } from './bridge';
import { Icon } from './icons';
import { MarkdownText, outlineOf } from './markdown';

const STATE = {
  drafting: 'Writing the plan…',
  ready: 'Ready for your review',
  incomplete: 'The turn ended before this plan was finished',
  approved: 'You chose to build this',
} as const;
/** Pinned above the thread, so the plan stays in view while you discuss it. */
export function PlanCard({
  session,
  onKeepPlanning,
}: {
  session: Session;
  onKeepPlanning: () => void;
}) {
  const plan = session.plan;
  const body = useRef<HTMLDivElement>(null);
  const [override, setOverride] = useState<boolean | null>(null);
  if (!plan) return null;
  const open = override ?? plan.status !== 'approved';
  const outline = outlineOf(plan.text);
  const pending = session.approval?.kind === 'plan';
  const busy = (session.status === 'running' || session.status === 'waiting') && !pending;
  return (
    <section className={`plan-card ${plan.status}`} aria-label="Plan">
      <div className="plan-header">
        <button
          type="button"
          className="plan-toggle"
          aria-expanded={open}
          onClick={() => setOverride(!open)}
        >
          <span className={`chevron ${open ? 'open' : ''}`}>
            <Icon name="chevron" size={11} />
          </span>
          <Icon name="plan" size={14} />
          <strong>Plan</strong>
          <span className={plan.status === 'drafting' ? 'shimmer' : 'plan-state'}>
            {STATE[plan.status]}
          </span>
        </button>
        {plan.status !== 'drafting' ? (
          <div className="plan-tools">
            <button
              type="button"
              className="icon-button"
              aria-label="Copy plan"
              title="Copy"
              onClick={() => send({ type: 'copy', text: plan.text })}
            >
              <Icon name="copy" size={13} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Save plan to docs/agent-work"
              title="Save to docs/agent-work/"
              onClick={() => send({ type: 'savePlan', id: session.id })}
            >
              <Icon name="save" size={13} />
            </button>
          </div>
        ) : null}
      </div>
      {open ? (
        <>
          {outline.length >= 3 ? (
            <nav className="plan-outline" aria-label="Plan outline">
              {outline.map((item, index) => (
                <button
                  type="button"
                  key={`${item.slug}-${index}`}
                  onClick={() =>
                    body.current
                      ?.querySelector(`[data-slug="${CSS.escape(item.slug)}"]`)
                      ?.scrollIntoView({ block: 'start' })
                  }
                >
                  {item.title}
                </button>
              ))}
            </nav>
          ) : null}
          <div className="plan-body markdown" ref={body}>
            <MarkdownText text={plan.text} streaming={plan.status === 'drafting'} />
          </div>
          {plan.status === 'ready' || plan.status === 'incomplete' ? (
            <div className="plan-actions">
              <button
                type="button"
                onClick={() => {
                  if (pending) send({ type: 'keepPlanning', id: session.id });
                  onKeepPlanning();
                }}
              >
                Keep planning
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => send({ type: 'buildPlan', id: session.id })}
              >
                Build it
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
