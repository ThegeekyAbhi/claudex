import { useState } from 'react';
import type { Message } from '../../../shared/model';
import { DiffCard, DiffStat } from '../changes/diff-view';
import type { MascotActivity } from '../mascot/activity';
import { Mascot } from '../mascot/mascot';
import { Chevron } from './step-state';
import { LegacyTool, Reasoning, ToolStep } from './tool-step';
import { activitySummary, diffsOf } from './view-model';

export function ActivityGroup({
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
