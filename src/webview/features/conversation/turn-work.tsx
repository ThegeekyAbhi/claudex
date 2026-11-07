import type { ReactNode } from 'react';
import type { Message } from '../../../shared/model';
import { DiffCard, DiffStat } from '../changes/diff-view';
import { Chevron } from './step-state';
import { activitySummary, diffsOf, duration } from './view-model';

/**
 * A finished turn's work, folded to one line: how long it took and what it did. Opening it shows
 * every note and step as they were. Edits stay visible either way, so a change is never hidden.
 */
export function TurnWork({
  messages,
  took,
  open,
  onToggle,
  sessionId,
  children,
}: {
  messages: Message[];
  /** How long the work took, when the CLI recorded it. */
  took?: number;
  open: boolean;
  onToggle(): void;
  sessionId: string;
  /** The notes and steps, shown when open. */
  children: ReactNode;
}) {
  const failed = messages.some((message) => message.tool?.status === 'failed');
  const diffs = diffsOf(messages);
  const totals = diffs.reduce(
    (sum, diff) => ({
      additions: sum.additions + diff.additions,
      deletions: sum.deletions + diff.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const summary = activitySummary(messages.filter((message) => message.role !== 'assistant'));
  return (
    <div className="turn-work my-2.5">
      <button
        type="button"
        className="gap-[5px] py-[3px] pr-1.5 pl-0.5 text-[12px] text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-transparent"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Chevron open={open} />
        <span>
          {took !== undefined ? `Worked ${duration(took)} · ` : 'Worked · '}
          {summary[0].toLowerCase() + summary.slice(1)}
        </span>
        {failed ? <span className="text-error">with failures</span> : null}
        {diffs.length ? <DiffStat {...totals} /> : null}
      </button>
      {open ? (
        <div className="mt-1 mb-2 ml-[7px] pl-2.5 border-l border-strong">{children}</div>
      ) : (
        // Folded, the edits still show; opened, each step group shows its own.
        diffs.map((diff, index) => (
          <DiffCard key={`${diff.path}-${index}`} diff={diff} sessionId={sessionId} />
        ))
      )}
    </div>
  );
}
