import { useState } from 'react';
import type { Message, ToolInfo } from '../../../shared/model';
import { Icon, type IconName } from '../../components/icons';
import { MarkdownText } from '../../lib/markdown';
import { Chevron, StepState } from './step-state';
import { duration, isPlanEdit, verb } from './view-model';

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
export function ToolStep({ message }: { message: Message }) {
  const tool = message.tool as ToolInfo;
  const [open, setOpen] = useState(false);
  const code = tool.kind === 'command' || tool.kind === 'search';
  const detail = [tool.input, message.text].filter(Boolean).join('\n\n');
  const body = (
    <>
      <Icon name={ICONS[tool.kind]} size={13} />
      <span className="flex-1 min-w-0 truncate">
        <span className="text-foreground">{verb(tool)}</span>{' '}
        {code ? (
          <code>{tool.title}</code>
        ) : (
          <span>{isPlanEdit(tool) ? 'the plan' : tool.title}</span>
        )}
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
export function LegacyTool({ text }: { text: string }) {
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
export function Reasoning({ message, active }: { message: Message; active: boolean }) {
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
