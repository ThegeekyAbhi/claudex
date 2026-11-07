import { Fragment, useContext, useEffect, useState } from 'react';
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
  type AgentCatalog,
  type AgentKind,
  type AgentProfile,
  allProfiles,
  type Catalog,
  canRun,
  catalogFor,
  findProfile,
  type ModelOption,
  profileLabel,
  profileProvider,
} from '../../../shared/model';
import { AgentMark, Icon } from '../../components/icons';
import { AccountsNavigation } from '../accounts/navigation';

export function effortLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high';
  return effort[0].toUpperCase() + effort.slice(1);
}
export interface ModelChoice {
  agent: AgentKind;
  model?: string;
}
const DEFAULT_DESCRIPTION = 'Whatever this CLI is configured to use';
/** Claude's profiles, then Codex's, as the host orders them. Missing CLIs stay listed, dimmed. */
function railAgents(): AgentKind[] {
  return allProfiles().map((profile) => profile.id);
}
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
  if (model)
    return catalogFor(catalog, agent).models.find((item) => item.id === model)?.label ?? model;
  if (!active) return 'Default';
  return catalogFor(catalog, agent).models.find((item) => item.id === active)?.label ?? active;
}
function Row({
  agent,
  model,
  label,
  description,
  checked,
  onChoose,
}: {
  agent: AgentKind;
  model?: ModelOption;
  label: string;
  description?: string;
  checked: boolean;
  onChoose: (choice: ModelChoice) => void;
}) {
  return (
    <CommandItem
      value={rowKey(agent, model?.id)}
      keywords={[profileLabel(agent), label, model?.id ?? 'default']}
      onSelect={() => onChoose({ agent, model: model?.id })}
      className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-2 rounded-sm cursor-default text-left select-none outline-none data-[selected=true]:bg-agent-tint data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint py-1 text-xs"
    >
      <span className="flex-1 min-w-0 flex flex-col text-[12px] [&_small]:text-[11px] [&_small]:text-muted-foreground">
        {label}
        <small className="whitespace-normal">
          {description ?? model?.description ?? DEFAULT_DESCRIPTION}
        </small>
      </span>
      {checked ? (
        <span className="inline-flex shrink-0 text-agent" role="img" aria-label="Selected">
          <Icon name="check" size={14} />
        </span>
      ) : null}
    </CommandItem>
  );
}
function PaneStatus({
  entry,
  profile,
  onRetry,
}: {
  entry: AgentCatalog;
  profile?: AgentProfile;
  onRetry: () => void;
}) {
  if (profile && !canRun(profile))
    return (
      <div className="flex flex-col gap-1 p-[7px] text-[11.5px] text-muted-foreground">
        <span className="text-foreground">
          {profile.status === 'missingCli' ? 'Not installed' : 'Not set up'}
        </span>
        <span className="whitespace-normal">{profile.problem}</span>
      </div>
    );
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
/** The tail of a long folder path, which is the part that tells accounts apart. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
}
/** What the rail's dot means, in words, for its tooltip. */
function railStatus(
  profile: AgentProfile | undefined,
  entry: AgentCatalog,
): { tone: 'failed' | 'waiting'; text: string } | undefined {
  if (profile && !canRun(profile))
    return {
      tone: 'waiting',
      text: profile.problem ?? (profile.status === 'missingCli' ? 'Not installed' : 'Not set up'),
    };
  if (entry.status === 'error') return { tone: 'failed', text: 'Could not read this CLI’s models' };
  return undefined;
}
const FOOTER_BUTTON =
  'shrink-0 px-1 py-px rounded-sm text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer';
function ProfileActions({ profile, onManage }: { profile: AgentProfile; onManage: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-faint">
      <span className="min-w-0 truncate" title={profile.homeDir ?? 'The CLI’s default folder'}>
        <span className="text-muted-foreground" title="Mention this profile with this handle">
          @{profile.id}
        </span>
        {' · '}
        {profile.homeDir ? shortPath(profile.homeDir) : 'default folder'}
      </span>
      <button type="button" className={FOOTER_BUTTON} onClick={onManage}>
        Manage account
      </button>
    </div>
  );
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
  const openAccounts = useContext(AccountsNavigation);
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
    const selected = catalogFor(catalog, agent).models.find((item) => item.id === model);
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
  const rail = railAgents();
  const paneProfile = findProfile(pane);
  const newThreadNote = lockedAgent && !searching && pane !== agent;
  const runnable = (id: AgentKind) => {
    const profile = findProfile(id);
    return !profile || canRun(profile);
  };
  // A profile that can't run has no models to pick, so only its status shows.
  const groups = searching ? rail.filter(runnable) : [pane];
  const label = modelLabel(catalog, agent, model, active);
  // The running thread reports the model "Default" resolved to; say so instead of guessing.
  const defaultDescription = (group: AgentKind) =>
    group === agent && active
      ? `Currently ${modelLabel(catalog, agent, undefined, active)}, from the CLI’s settings`
      : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-agent={profileProvider(agent)}
          className={`chip gap-[5px] min-h-6 px-1.5 py-[3px] text-[11.5px] text-muted-foreground whitespace-nowrap enabled:hover:text-foreground enabled:hover:bg-muted aria-expanded:text-foreground aria-expanded:bg-muted max-[480px]:in-[.composer-controls]:not-[.mode-chip]:min-w-0 max-[480px]:in-[.composer-controls]:not-[.mode-chip]:shrink `}
          aria-label={`Model: ${profileLabel(agent)} ${label}`}
        >
          <AgentMark agent={agent} />
          {/* The mark names the CLI, so a second profile of it also shows its name. */}
          {!findProfile(agent)?.builtin ? (
            <span className="text-foreground">{profileLabel(agent)}</span>
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
          {rail.map((item, index) => (
            <Fragment key={item}>
              {index > 0 && profileProvider(rail[index - 1]) !== profileProvider(item) ? (
                <span role="presentation" className="mx-1.5 my-1 h-px bg-subtle" />
              ) : null}
              <button
                type="button"
                role="tab"
                tabIndex={0}
                aria-selected={!searching && item === pane}
                data-agent={profileProvider(item)}
                className="rail-item justify-start gap-[7px] min-h-[26px] px-1.5 py-[3px] text-[12px] text-muted-foreground enabled:hover:text-foreground aria-selected:bg-agent-tint aria-selected:text-foreground aria-selected:enabled:hover:bg-agent-tint max-[900px]:gap-[5px] max-[900px]:px-[5px]"
                aria-label={profileLabel(item)}
                title={railStatus(findProfile(item), catalogFor(catalog, item))?.text}
                onClick={() => switchPane(item)}
              >
                <AgentMark agent={item} />
                <span className={`min-w-0 truncate ${runnable(item) ? '' : 'opacity-50'}`}>
                  {profileLabel(item)}
                </span>
                {(() => {
                  const status = railStatus(findProfile(item), catalogFor(catalog, item));
                  return status ? (
                    <span
                      data-status={status.tone}
                      className={`status-dot size-1.5 rounded-full shrink-0 inline-block ml-auto ${status.tone === 'failed' ? 'bg-error' : 'bg-warning'}`}
                    />
                  ) : null;
                })()}
              </button>
            </Fragment>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            className="rail-item justify-start gap-[7px] min-h-[26px] px-1.5 py-[3px] text-[11.5px] text-muted-foreground enabled:hover:text-foreground"
            title="Add another account for Claude Code or Codex, with its own folder"
            onClick={() => {
              setOpen(false);
              openAccounts(undefined, true);
            }}
          >
            <Icon name="plus" size={12} />
            <span className="min-w-0 truncate">Add profile</span>
          </button>
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
            const index = rail.indexOf(pane) + step + rail.length;
            switchPane(rail[index % rail.length]);
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
              Picking {profileLabel(pane)} opens a new thread.
            </div>
          ) : null}
          <CommandList className="flex-1 min-h-0 overflow-y-auto p-1 scroll-py-1 border-b border-subtle max-h-none">
            <CommandEmpty className="flex items-center gap-[7px] p-[7px] text-[11.5px] text-muted-foreground">
              No matching models.
            </CommandEmpty>
            {groups.map((group) => {
              if (!runnable(group))
                return (
                  <PaneStatus
                    key={group}
                    entry={catalogFor(catalog, group)}
                    profile={findProfile(group)}
                    onRetry={onRetry}
                  />
                );
              const models = catalogFor(catalog, group).models;
              const older = models.filter((item) => isOlderModel(group, item));
              const primary = models.filter((item) => !isOlderModel(group, item));
              const rows = searching || expanded ? [...primary, ...older] : primary;
              return (
                <CommandGroup
                  key={group}
                  heading={searching ? profileLabel(group) : undefined}
                  data-agent={profileProvider(group)}
                  className="menu-group"
                >
                  <Row
                    agent={group}
                    label="Default"
                    description={defaultDescription(group)}
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
                  {!searching ? (
                    <PaneStatus entry={catalogFor(catalog, group)} onRetry={onRetry} />
                  ) : null}
                </CommandGroup>
              );
            })}
          </CommandList>
          {paneProfile && !searching ? (
            <ProfileActions
              profile={paneProfile}
              onManage={() => {
                setOpen(false);
                openAccounts(paneProfile.id);
              }}
            />
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
