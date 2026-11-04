import * as Popover from '@radix-ui/react-popover';
import { useRef, useState } from 'react';
import type { Usage, UsageLimit } from '../model';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Past this, the indicator shows its number and offers a way forward. */
const NOTICE = 70;
const WARN = 85;
const FULL = 95;

function level(percent: number): 'calm' | 'notice' | 'warn' | 'full' {
  if (percent >= FULL) return 'full';
  if (percent >= WARN) return 'warn';
  return percent >= NOTICE ? 'notice' : 'calm';
}
function resetText(limit: UsageLimit, now: number): string | undefined {
  if (!limit.resetsAt) return undefined;
  const minutes = Math.ceil((limit.resetsAt - now) / 60_000);
  if (minutes < 60) return `Resets in ${minutes}m`;
  if (minutes < 1_440)
    return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim();
  const date = new Date(limit.resetsAt);
  return `Resets ${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
}
function Bar({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`usage-bar ${level(percent)}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}
/**
 * A quiet ring beside the send button, after AI Elements' Context component. It shows only what
 * the CLI reported, so nothing appears until a turn has reported something.
 */
export function UsageIndicator({ usage, onHandOff }: { usage?: Usage; onHandOff?: () => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  if (!usage) return null;
  const now = Date.now();
  const context = usage.context;
  const contextPercent = context ? (context.used / context.max) * 100 : undefined;
  // A window that has already reset says nothing about now.
  const limits = (usage.limits ?? []).filter((item) => !item.resetsAt || item.resetsAt > now);
  if (contextPercent === undefined && !limits.length) return null;
  const highestLimit = limits.reduce((top, item) => Math.max(top, item.usedPercent), 0);
  const shown = contextPercent ?? highestLimit;
  const worst = Math.max(contextPercent ?? 0, highestLimit);
  const state = level(worst);
  const hover = (next: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? 180 : 140);
  };
  const summary =
    contextPercent !== undefined
      ? `Context ${Math.round(contextPercent)}% used`
      : `Plan limit ${Math.round(highestLimit)}% used`;
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`usage-trigger ${state}`}
          aria-label={summary}
          onMouseEnter={() => hover(true)}
          onMouseLeave={() => hover(false)}
        >
          {state === 'calm' ? null : <span>{Math.round(worst)}%</span>}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="usage-track" cx="8" cy="8" r={RADIUS} />
            <circle
              className="usage-fill"
              cx="8"
              cy="8"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(100, shown) / 100)}
              transform="rotate(-90 8 8)"
            />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover usage-card"
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Usage"
          onMouseEnter={() => hover(true)}
          onMouseLeave={() => hover(false)}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {context && contextPercent !== undefined ? (
            <section>
              <div className="usage-row">
                <strong>Context</strong>
                <span>{Math.round(contextPercent)}%</span>
              </div>
              <Bar percent={contextPercent} label="Context used" />
              <small>
                {compact.format(context.used)} of {compact.format(context.max)} tokens
              </small>
            </section>
          ) : null}
          {limits.length ? (
            <section>
              {limits.map((limit) => (
                <div className="usage-limit" key={limit.id}>
                  <div className="usage-row">
                    <strong>{limit.label} limit</strong>
                    <span>{Math.round(limit.usedPercent)}%</span>
                  </div>
                  <Bar percent={limit.usedPercent} label={`${limit.label} limit used`} />
                  {resetText(limit, now) ? <small>{resetText(limit, now)}</small> : null}
                </div>
              ))}
            </section>
          ) : null}
          {worst >= WARN && onHandOff ? (
            <section className="usage-help">
              <p>
                {(contextPercent ?? 0) >= WARN
                  ? 'This thread is nearly full. Hand off to carry on in a fresh thread, from a summary you review.'
                  : 'You are close to this plan limit. Hand off to carry on with another agent.'}
              </p>
              <button type="button" onClick={onHandOff}>
                Hand off to another agent
              </button>
            </section>
          ) : null}
          <footer>Reported {ago(usage.updatedAt, now)}</footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
