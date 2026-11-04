import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Command } from 'cmdk';
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AGENT_LABELS,
  type AgentCatalog,
  type AgentKind,
  type Catalog,
  type ModelOption,
} from '../model';
import { AgentMark, Icon } from './icons';

export function effortLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high';
  return effort[0].toUpperCase() + effort.slice(1);
}
/** A quick label for an icon button. No motion: these appear many times a day. */
export function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="hint" side="bottom" sideOffset={4} collisionPadding={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
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
    <Command.Item
      value={rowKey(agent, model?.id)}
      keywords={[AGENT_LABELS[agent], label, model?.id ?? 'default']}
      onSelect={() => onChoose({ agent, model: model?.id })}
      className="menu-item"
    >
      <span className="menu-item-text">{label}</span>
      {checked ? (
        <span className="menu-check" role="img" aria-label="Selected">
          <Icon name="check" size={14} />
        </span>
      ) : null}
    </Command.Item>
  );
}
/** One calm row: a stepped track, with the name of whatever you are pointing at. */
function EffortTrack({
  effort,
  efforts,
  onEffort,
}: {
  effort?: string;
  efforts: string[];
  onEffort: (effort?: string) => void;
}) {
  const [preview, setPreview] = useState<string>();
  const levels = [undefined, ...efforts];
  const current = levels.indexOf(effort);
  return (
    <fieldset
      className="effort-row"
      aria-label="Reasoning effort"
      onMouseLeave={() => setPreview(undefined)}
    >
      <span className="effort-name">Effort</span>
      <div className="effort-track">
        {levels.map((item, index) => {
          const name = item ? effortLabel(item) : 'Default';
          return (
            <button
              type="button"
              key={item ?? 'default'}
              className={item ? 'effort-step' : 'effort-step default'}
              aria-label={name}
              aria-pressed={effort === item}
              data-on={item ? index <= current : current === 0}
              onMouseEnter={() => setPreview(name)}
              onFocus={() => setPreview(name)}
              onBlur={() => setPreview(undefined)}
              onClick={() => onEffort(item)}
            />
          );
        })}
      </div>
      <span className="effort-value">{preview ?? (effort ? effortLabel(effort) : 'Default')}</span>
    </fieldset>
  );
}
function PaneStatus({ entry, onRetry }: { entry: AgentCatalog; onRetry: () => void }) {
  if (entry.status === 'loading')
    return (
      <div className="menu-empty">
        <span className="spinner" /> Reading models…
      </div>
    );
  if (entry.status === 'error')
    return (
      <div className="menu-error">
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
  effort,
  efforts = [],
  onEffort,
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
  effort?: string;
  /** The levels the chosen model supports. */
  efforts?: string[];
  onEffort?: (effort?: string) => void;
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
  const description = useMemo(() => {
    if (highlight.endsWith(':__more')) return '';
    const [rowAgent, ...rest] = highlight.split(':');
    const id = rest.join(':');
    const models = catalog[rowAgent as AgentKind]?.models ?? [];
    return models.find((item) => item.id === id)?.description ?? DEFAULT_DESCRIPTION;
  }, [catalog, highlight]);
  const newThreadNote = lockedAgent && !searching && pane !== agent;
  const groups = searching ? RAIL : [pane];
  const label = modelLabel(catalog, agent, model, active);
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="chip"
          aria-label={`Model: ${AGENT_LABELS[agent]} ${label}${effort ? `, ${effort} effort` : ''}`}
        >
          <AgentMark agent={agent} />
          {/* The mark names the agent, except that both Claude accounts share one. */}
          {agent === 'claud2' ? <span className="chip-agent">{AGENT_LABELS[agent]}</span> : null}
          <span className="chip-model">{label}</span>
          {effort ? <span className="chip-effort">{effortLabel(effort)}</span> : null}
          <Icon name="chevronDown" size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover model-menu"
          side="top"
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
            className="model-rail"
            role="tablist"
            aria-label="Agents"
            aria-orientation="vertical"
          >
            {RAIL.map((item) => (
              <button
                type="button"
                role="tab"
                tabIndex={-1}
                key={item}
                aria-selected={!searching && item === pane}
                className="rail-item"
                aria-label={AGENT_LABELS[item]}
                onClick={() => switchPane(item)}
              >
                <AgentMark agent={item} />
                <span className="rail-label">{AGENT_LABELS[item]}</span>
                {catalog[item].status === 'error' ? <span className="status-dot failed" /> : null}
              </button>
            ))}
          </div>
          <Command
            className="model-pane"
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
            <div className="menu-search">
              <Icon name="search" size={14} />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search models…"
                aria-label="Search models"
              />
            </div>
            {newThreadNote ? (
              <div className="menu-note">Picking {AGENT_LABELS[pane]} opens a new thread.</div>
            ) : null}
            <Command.List className="menu-list">
              <Command.Empty className="menu-empty">No matching models.</Command.Empty>
              {groups.map((group) => {
                const models = catalog[group].models;
                const older = models.filter((item) => isOlderModel(group, item));
                const primary = models.filter((item) => !isOlderModel(group, item));
                const rows = searching || expanded ? [...primary, ...older] : primary;
                return (
                  <Command.Group
                    key={group}
                    heading={searching ? AGENT_LABELS[group] : undefined}
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
                      <Command.Item
                        value={`${group}:__more`}
                        className="menu-item menu-more"
                        onSelect={() => {
                          // This row is about to disappear, so hand the highlight to what it revealed.
                          setExpanded(true);
                          setHighlight(rowKey(group, older[0].id));
                        }}
                      >
                        <span className="menu-item-text">More models</span>
                        <span className="menu-count">{older.length}</span>
                      </Command.Item>
                    ) : null}
                    {!searching ? <PaneStatus entry={catalog[group]} onRetry={onRetry} /> : null}
                  </Command.Group>
                );
              })}
            </Command.List>
            {efforts.length && onEffort && !searching && pane === agent ? (
              <EffortTrack effort={effort} efforts={efforts} onEffort={onEffort} />
            ) : null}
            {description ? (
              <div className="menu-footer" title={description}>
                {description}
              </div>
            ) : null}
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  selected?: boolean;
  onSelect: () => void;
}
/** A small dropdown for short choices such as effort and location. */
export function Menu({
  label,
  icon,
  ariaLabel,
  items,
  heading,
  disabled,
  className = '',
  onClosed,
}: {
  label: string;
  icon?: ReactNode;
  ariaLabel: string;
  items: MenuItem[];
  heading?: string;
  disabled?: boolean;
  className?: string;
  onClosed?: () => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button type="button" className={`chip ${className}`} aria-label={ariaLabel}>
          {icon}
          <span className="chip-model">{label}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="popover small-menu"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (!onClosed) return;
            event.preventDefault();
            onClosed();
          }}
        >
          {heading ? (
            <DropdownMenu.Label className="menu-label">{heading}</DropdownMenu.Label>
          ) : null}
          <DropdownMenu.RadioGroup value={items.find((item) => item.selected)?.key ?? ''}>
            {items.map((item) => (
              <DropdownMenu.RadioItem
                key={item.key}
                value={item.key}
                className="menu-item"
                onSelect={item.onSelect}
              >
                {item.icon}
                <span className="menu-item-text">
                  <span>{item.label}</span>
                  {item.description ? <small>{item.description}</small> : null}
                </span>
                <DropdownMenu.ItemIndicator className="menu-check">
                  <Icon name="check" size={14} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
/** Less frequent thread actions, so the header fits a narrow panel. */
export function OverflowMenu({
  items,
}: {
  items: {
    key: string;
    label: string;
    icon: ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }[];
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="icon-button" aria-label="More actions">
          <Icon name="more" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="popover small-menu"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.key}
              className="menu-item"
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {item.icon}
              <span className="menu-item-text">{item.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
