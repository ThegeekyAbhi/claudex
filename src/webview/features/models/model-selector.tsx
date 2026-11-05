import { useEffect, useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AGENT_LABELS,
  type AgentCatalog,
  type AgentKind,
  type Catalog,
  type ModelOption,
} from '../../../core/model';
import { AgentMark, Icon } from '../../components/icons';

export function effortLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high';
  return effort[0].toUpperCase() + effort.slice(1);
}
export interface ModelChoice {
  agent: AgentKind;
  model?: string;
}
const DEFAULT_DESCRIPTION = 'Whatever this CLI is configured to use';
/** Your order, top to bottom. */
const RAIL: AgentKind[] = ['claude', 'claud2', 'codex'];
function rowKey(agent: AgentKind, model?: string): string {
  return `${agent}:${model ?? 'default'}`;
}
/** Older versions sit behind "More models", so the everyday choices are quick to scan. */
export function isOlderModel(agent: AgentKind, model: ModelOption): boolean {
  return agent === 'codex'
    ? /^(older|previous)\b/i.test(model.description)
    : /^claude-/.test(model.id);
}
export function modelLabel(
  catalog: Catalog,
  agent: AgentKind,
  model?: string,
  active?: string,
): string {
  if (model) return catalog[agent].models.find((item) => item.id === model)?.label ?? model;
  if (!active) return 'Default';
  return catalog[agent].models.find((item) => item.id === active)?.label ?? active;
}
function Row({
  agent,
  model,
  label,
  checked,
  onChoose,
}: {
  agent: AgentKind;
  model?: ModelOption;
  label: string;
  checked: boolean;
  onChoose: (choice: ModelChoice) => void;
}) {
  return (
    <CommandItem
      value={rowKey(agent, model?.id)}
      keywords={[AGENT_LABELS[agent], label, model?.id ?? 'default']}
      onSelect={() => onChoose({ agent, model: model?.id })}
      className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-2 rounded-sm cursor-default text-left select-none outline-none data-[selected=true]:bg-agent-tint data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint py-1 text-xs"
    >
      <span className="flex-1 min-w-0 flex flex-col text-[12px] [&_small]:text-[11px] [&_small]:text-muted-foreground">
        {label}
        <small className="whitespace-normal">{model?.description ?? DEFAULT_DESCRIPTION}</small>
      </span>
      {checked ? (
        <span className="inline-flex shrink-0 text-agent" role="img" aria-label="Selected">
          <Icon name="check" size={14} />
        </span>
      ) : null}
    </CommandItem>
  );
}
function PaneStatus({ entry, onRetry }: { entry: AgentCatalog; onRetry: () => void }) {
  if (entry.status === 'loading')
    return (
      <div className="flex items-center gap-[7px] p-[7px] text-[11.5px] text-muted-foreground">
        <span className="spinner size-[11px] shrink-0 inline-block rounded-full border-[1.5px] border-strong border-t-foreground animate-spinner motion-reduce:animate-none" />{' '}
        Reading models…
      </div>
    );
  if (entry.status === 'error')
    return (
      <div className="flex items-center gap-[7px] p-[7px] text-[11.5px] justify-between text-error [&_button]:px-1.5 [&_button]:py-px [&_button]:text-[11px] [&_button]:text-foreground [&_button]:border-strong">
        <span title={entry.error}>Could not read this CLI’s models.</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  return null;
}
/** Agents on the left, that agent's models on the right. Searching looks across all agents. */
export function ModelSelector({
  catalog,
  agent,
  model,
  active,
  lockedAgent,
  side = 'top',
  onSelect,
  onRetry,
  onClosed,
}: {
  catalog: Catalog;
  agent: AgentKind;
  model?: string;
  active?: string;
  /** Set once a thread has started: picking another agent opens a new thread instead. */
  lockedAgent?: boolean;
  side?: 'top' | 'bottom';
  onSelect: (choice: ModelChoice) => void;
  onRetry: () => void;
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState(agent);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const selectedKey = rowKey(agent, model);
  const [highlight, setHighlight] = useState(selectedKey);
  const searching = query.trim().length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the menu opens, so catalog updates cannot move the highlight
  useEffect(() => {
    if (!open) return;
    setPane(agent);
    setQuery('');
    setHighlight(selectedKey);
    const selected = catalog[agent].models.find((item) => item.id === model);
    setExpanded(Boolean(selected && isOlderModel(agent, selected)));
  }, [open]);
  function switchPane(next: AgentKind) {
    setPane(next);
    setExpanded(false);
    setQuery('');
    setHighlight(next === agent ? selectedKey : rowKey(next));
  }
  function choose(choice: ModelChoice) {
    setOpen(false);
    onSelect(choice);
  }
  const newThreadNote = lockedAgent && !searching && pane !== agent;
  const groups = searching ? RAIL : [pane];
  const label = modelLabel(catalog, agent, model, active);
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-agent={agent}
          className={`chip gap-[5px] min-h-6 px-1.5 py-[3px] text-[11.5px] text-muted-foreground whitespace-nowrap enabled:hover:text-foreground enabled:hover:bg-muted aria-expanded:text-foreground aria-expanded:bg-muted max-[480px]:in-[.composer-controls]:not-[.mode-chip]:min-w-0 max-[480px]:in-[.composer-controls]:not-[.mode-chip]:shrink `}
          aria-label={`Model: ${AGENT_LABELS[agent]} ${label}`}
        >
          <AgentMark agent={agent} />
          {/* The mark names the agent, except that both Claude accounts share one. */}
          {agent === 'claud2' ? (
            <span className="text-foreground">{AGENT_LABELS[agent]}</span>
          ) : null}
          <span className="text-foreground max-[480px]:min-w-0 max-[480px]:overflow-hidden max-[480px]:text-ellipsis">
            {label}
          </span>
          <Icon name="chevronDown" size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="bg-overlay text-foreground border border-strong z-50 rounded-md shadow-md animate-menu-in [transform-origin:var(--radix-popover-content-transform-origin,var(--radix-dropdown-menu-content-transform-origin))] focus:outline-none focus-visible:outline-none motion-reduce:animate-none grid grid-cols-[112px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[108px_minmax(0,1fr)] h-[min(320px,var(--radix-popover-content-available-height,320px))] w-[min(420px,var(--radix-popover-content-available-width,420px))] p-0 ring-0"
        side={side}
        align="start"
        sideOffset={6}
        collisionPadding={8}
        aria-label="Choose a model"
        onCloseAutoFocus={(event) => {
          if (!onClosed) return;
          event.preventDefault();
          onClosed();
        }}
      >
        <div
          className="flex flex-col gap-px p-[5px] border-r border-subtle"
          role="tablist"
          aria-label="Agents"
          aria-orientation="vertical"
        >
          {RAIL.map((item) => (
            <button
              type="button"
              role="tab"
              tabIndex={0}
              key={item}
              aria-selected={!searching && item === pane}
              data-agent={item}
              className="rail-item justify-start gap-[7px] min-h-[26px] px-1.5 py-[3px] text-[12px] text-muted-foreground enabled:hover:text-foreground aria-selected:bg-agent-tint aria-selected:text-foreground aria-selected:enabled:hover:bg-agent-tint max-[900px]:gap-[5px] max-[900px]:px-[5px]"
              aria-label={AGENT_LABELS[item]}
              onClick={() => switchPane(item)}
            >
              <AgentMark agent={item} />
              <span className="min-w-0 truncate">{AGENT_LABELS[item]}</span>
              {catalog[item].status === 'error' ? (
                <span className="status-dot size-1.5 rounded-full bg-muted-foreground shrink-0 inline-block [&.quiet]:bg-faint [&.quiet]:opacity-50 [&.waiting]:bg-warning [&.failed]:bg-error in-[.rail-item]:ml-auto failed" />
              ) : null}
            </button>
          ))}
        </div>
        <Command
          className="flex flex-col min-w-0 min-h-0 rounded-none bg-transparent"
          label="Models"
          loop
          value={highlight}
          onValueChange={setHighlight}
          onKeyDown={(event) => {
            if (searching || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
            event.preventDefault();
            const step = event.key === 'ArrowRight' ? 1 : -1;
            const index = RAIL.indexOf(pane) + step + RAIL.length;
            switchPane(RAIL[index % RAIL.length]);
          }}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search models…"
            aria-label="Search models"
            className="h-8 text-xs focus-visible:outline-none"
          />
          {newThreadNote ? (
            <div className="px-2.5 py-[5px] text-[11px] text-warning border-b border-subtle shrink-0">
              Picking {AGENT_LABELS[pane]} opens a new thread.
            </div>
          ) : null}
          <CommandList className="flex-1 min-h-0 overflow-y-auto p-1 scroll-py-1 border-b border-subtle max-h-none">
            <CommandEmpty className="flex items-center gap-[7px] p-[7px] text-[11.5px] text-muted-foreground">
              No matching models.
            </CommandEmpty>
            {groups.map((group) => {
              const models = catalog[group].models;
              const older = models.filter((item) => isOlderModel(group, item));
              const primary = models.filter((item) => !isOlderModel(group, item));
              const rows = searching || expanded ? [...primary, ...older] : primary;
              return (
                <CommandGroup
                  key={group}
                  heading={searching ? AGENT_LABELS[group] : undefined}
                  data-agent={group}
                  className="menu-group"
                >
                  <Row
                    agent={group}
                    label="Default"
                    checked={selectedKey === rowKey(group)}
                    onChoose={choose}
                  />
                  {rows.map((item) => (
                    <Row
                      key={item.id}
                      agent={group}
                      model={item}
                      label={item.label}
                      checked={selectedKey === rowKey(group, item.id)}
                      onChoose={choose}
                    />
                  ))}
                  {!searching && !expanded && older.length ? (
                    <CommandItem
                      value={`${group}:__more`}
                      className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-2 rounded-sm cursor-default text-left select-none outline-none data-[selected=true]:bg-agent-tint data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint text-muted-foreground py-1 text-xs"
                      onSelect={() => {
                        // This row is about to disappear, so hand the highlight to what it revealed.
                        setExpanded(true);
                        setHighlight(rowKey(group, older[0].id));
                      }}
                    >
                      <span className="flex-1 min-w-0 flex flex-col text-[12px] [&_small]:text-[11px] [&_small]:text-muted-foreground">
                        More models
                      </span>
                      <span className="text-[11px] text-faint tabular-nums">{older.length}</span>
                    </CommandItem>
                  ) : null}
                  {!searching ? <PaneStatus entry={catalog[group]} onRetry={onRetry} /> : null}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
