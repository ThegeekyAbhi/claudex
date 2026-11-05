import { useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { modeView, type Session, type Usage, type UsageLimit } from '../../../core/model';

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
    <Progress
      className={`[&_[data-slot=progress-indicator]]:bg-muted-foreground [&.warn_[data-slot=progress-indicator]]:bg-warning [&.full_[data-slot=progress-indicator]]:bg-error h-[3px] rounded-sm bg-border ${level(percent)}`}
      value={value}
      aria-label={label}
    />
  );
}
const HEALTHY = new Set(['connected', 'ready', 'running', 'pending', 'starting']);
function fileName(file: string): string {
  return file.split(/[\\/]/).at(-1) ?? file;
}
/** Everything here is something a CLI reported or you did. Nothing is inferred. */
function threadDetails(session: Session) {
  const rows: { label: string; value: string; warn?: boolean }[] = [];
  const mode = modeView(session.mode, session.reportedMode);
  if (session.provider === 'codex' && session.mode === 'auto' && !session.reportedMode)
    mode.label = 'Auto requested';
  if (session.mode || session.reportedMode) rows.push({ label: 'Mode', value: mode.label });
  const requested = new Set<string>();
  const used = new Set<string>();
  for (const message of session.messages) {
    for (const item of message.attachments ?? [])
      if (item.kind === 'skill') requested.add(item.name);
    if (message.tool?.name === 'Skill' && message.tool.title.startsWith('Used skill '))
      used.add(message.tool.title.slice('Used skill '.length));
  }
  if (requested.size) rows.push({ label: 'Skills asked for', value: [...requested].join(', ') });
  if (used.size) rows.push({ label: 'Skills used', value: [...used].join(', ') });
  const servers = session.runtime?.mcpServers ?? [];
  const failed = servers.filter((item) => item.status && !HEALTHY.has(item.status));
  if (failed.length)
    rows.push({
      label: 'MCP problem',
      value: failed.map((item) => `${item.name}: ${item.status}`).join(', '),
      warn: true,
    });
  const healthy = servers.length - failed.length;
  if (healthy > 0) rows.push({ label: 'MCP servers', value: String(healthy) });
  const files = session.runtime?.instructionFiles ?? [];
  if (files.length) rows.push({ label: 'Instructions', value: files.map(fileName).join(', ') });
  // Mode alone isn't worth a ring of its own. The chip already shows it.
  return { rows, failed, worthShowing: failed.length > 0 || requested.size > 0 || used.size > 0 };
}
/**
 * Compact usage beside the send button. It shows only what
 * the CLI reported, so nothing appears until a turn has reported something.
 */
export function UsageIndicator({
  session,
  onHandOff,
}: {
  session?: Session;
  onHandOff?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const usage: Usage | undefined = session?.usage;
  const details = session ? threadDetails(session) : undefined;
  if (!usage && !details?.worthShowing) return null;
  const now = Date.now();
  const context = usage?.context;
  const contextPercent = context ? (context.used / context.max) * 100 : undefined;
  // A window that has already reset says nothing about now.
  const limits = (usage?.limits ?? []).filter((item) => !item.resetsAt || item.resetsAt > now);
  if (contextPercent === undefined && !limits.length && !details?.worthShowing) return null;
  const highestLimit = limits.reduce((top, item) => Math.max(top, item.usedPercent), 0);
  const shown = contextPercent ?? highestLimit;
  const worst = Math.max(contextPercent ?? 0, highestLimit);
  const state = level(worst);
  const hover = (next: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? 180 : 140);
  };
  const failed = details?.failed ?? [];
  const inlineUsage = [
    ...(contextPercent !== undefined ? [`Ctx ${Math.round(contextPercent)}%`] : []),
    ...limits.map((limit) => {
      const label = limit.label.replace(/^Weekly/, 'Week').replace(/(\d+)-hour/, '$1h');
      return `${label} ${Math.round(limit.usedPercent)}%`;
    }),
  ].join(' · ');
  const summary = [
    contextPercent !== undefined
      ? `Context ${Math.round(contextPercent)}% used`
      : limits.length
        ? `Plan limit ${Math.round(highestLimit)}% used`
        : 'Thread details',
    ...limits.map((limit) => `${limit.label} limit ${Math.round(limit.usedPercent)}% used`),
    ...(failed.length ? [`${failed.length} MCP server needs attention`] : []),
  ].join(', ');
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 min-h-6 px-1 py-0 text-[10.5px] tabular-nums text-faint enabled:hover:text-muted-foreground aria-expanded:text-muted-foreground [&_svg]:fill-none [&_svg]:stroke-2 [&.notice]:text-muted-foreground [&.warn]:text-warning [&.full]:text-error ${state}`}
          aria-label={summary}
          onMouseEnter={() => hover(true)}
          onMouseLeave={() => hover(false)}
        >
          {failed.length ? (
            <span
              aria-hidden="true"
              data-testid="mcp-dot"
              className="size-1.5 rounded-full bg-[var(--warning)]"
            />
          ) : null}
          {inlineUsage ? (
            <span
              className="max-w-[180px] truncate @max-[640px]:hidden"
              title={`${inlineUsage} used`}
            >
              {inlineUsage}
            </span>
          ) : null}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle className="stroke-strong" cx="8" cy="8" r={RADIUS} />
            <circle
              className="stroke-current [stroke-linecap:round] [transition:stroke-dashoffset_300ms_ease]"
              cx="8"
              cy="8"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(100, shown) / 100)}
              transform="rotate(-90 8 8)"
            />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="bg-overlay text-foreground border border-strong z-50 rounded-md shadow-md animate-menu-in [transform-origin:var(--radix-popover-content-transform-origin,var(--radix-dropdown-menu-content-transform-origin))] focus:outline-none focus-visible:outline-none motion-reduce:animate-none text-[11.5px] [&_section]:px-[11px] [&_section]:py-[9px] [&_section]:flex [&_section]:flex-col [&_section]:gap-[5px] [&_section+section]:border-t [&_section+section]:border-subtle [&_small]:text-[10.5px] [&_small]:text-faint [&_footer]:pt-[5px] [&_footer]:px-[11px] [&_footer]:pb-[7px] [&_footer]:border-t [&_footer]:border-subtle [&_footer]:text-[10.5px] [&_footer]:text-faint w-[236px] p-0 ring-0"
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        aria-label="Thread details"
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {context && contextPercent !== undefined ? (
          <section>
            <div className="flex justify-between gap-2 tabular-nums text-muted-foreground [&_strong]:font-[450] [&_strong]:text-foreground">
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
              <div className="flex flex-col gap-[5px] [&+&]:mt-1.5" key={limit.id}>
                <div className="flex justify-between gap-2 tabular-nums text-muted-foreground [&_strong]:font-[450] [&_strong]:text-foreground">
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
          <section className="[&_p]:m-0 [&_p]:text-muted-foreground [&_p]:leading-[1.4] [&_button]:self-start [&_button]:min-h-[22px] [&_button]:px-[7px] [&_button]:py-px [&_button]:-ml-[7px] [&_button]:text-[11.5px] [&_button]:text-foreground">
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
        {details?.rows.length ? (
          <section className="grid gap-1">
            {details.rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-3 text-[11px]">
                <span className="text-muted-foreground">{row.label}</span>
                <span
                  className={`min-w-0 truncate text-right ${row.warn ? 'text-[var(--warning)]' : 'text-foreground'}`}
                  title={row.value}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {usage ? <footer>Reported {ago(usage.updatedAt, now)}</footer> : null}
      </PopoverContent>
    </Popover>
  );
}
