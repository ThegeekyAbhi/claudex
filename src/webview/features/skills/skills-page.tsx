import { useEffect, useId, useRef, useState } from 'react';
import {
  type AgentKind,
  agentTarget,
  CAPABILITIES,
  profileLabel,
  runnableProfiles,
  type Session,
  SKILL_SOURCE_LABELS,
  type SkillCatalog,
  type SkillCatalogs,
  type SkillSource,
  skillsFor,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon } from '../../components/icons';
import { Hint, OverflowMenu } from '../../components/menus';
import { Button } from '../../components/ui/button';
import { moveTabFocus } from '../../lib/roving-tabs';
import { ConfigurationView } from './configuration-view';
import {
  ALL,
  canMakeGlobal,
  combinedStatus,
  globalRequest,
  type Row,
  rowId,
  type Scope,
  selectRows,
} from './skill-rows';

const GROUP_LABEL: Record<SkillSource | 'other', string> = {
  ...SKILL_SOURCE_LABELS,
  other: 'Reported by the agent',
};
const CHIP =
  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-subtle text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:border-strong';
const TAB =
  'h-8 px-1 -mb-px border-b-2 border-transparent text-[12.5px] text-muted-foreground hover:text-foreground aria-selected:border-[var(--focus)] aria-selected:text-foreground rounded-none';
/**
 * Skills as a page: every account's skills, searchable in one place. Disk discovery, native
 * verification and use stay separate observations, and nothing here starts a CLI unasked.
 */
export function SkillsPage({
  catalogs,
  currentAgent,
  intent,
  active,
  session,
}: {
  catalogs: SkillCatalogs;
  /** The account of the open thread or new chat. */
  currentAgent: AgentKind;
  intent: { agent?: AgentKind; query?: string; key: number };
  active: boolean;
  session?: Session;
}) {
  const profiles = runnableProfiles();
  const [scope, setScope] = useState<Scope>(intent.agent ?? currentAgent);
  const [search, setSearch] = useState(intent.query ?? '');
  const [missingOnly, setMissingOnly] = useState(false);
  const [view, setView] = useState<'skills' | 'configuration'>('skills');
  /** Rows picked for Make global, by row id. Only visible, eligible rows count. */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const heading = useRef<HTMLHeadingElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const tabsId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: each open request starts fresh
  useEffect(() => {
    if (intent.agent) setScope(intent.agent);
    setSearch(intent.query ?? '');
    setMissingOnly(false);
    setView('skills');
    (intent.query ? searchBox.current : heading.current)?.focus();
  }, [intent.key]);
  // A scope that's no longer runnable falls back to everything.
  const scopeValid = scope === ALL || profiles.some((profile) => profile.id === scope);
  const shown: Scope = scopeValid ? scope : ALL;
  const agent: AgentKind = shown === ALL ? currentAgent : shown;
  const profileIds = profiles.map((profile) => profile.id).join(' ');
  const catalog = skillsFor(catalogs, agent);
  const cwd = catalog.cwd;
  // Every account, so counts, "missing here" and the All view are current. File scans only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed project invalidates every catalog
  useEffect(() => {
    if (!active) return;
    for (const id of profileIds.split(' ').filter(Boolean))
      send({ type: 'refreshSkills', agent: id });
  }, [active, profileIds, cwd]);

  const { missing, rows, groups, eligible, allCount } = selectRows({
    catalogs,
    accounts: profiles,
    scope: shown,
    agent,
    missingOnly,
    search,
  });
  const chosen = eligible.filter((row) => picked.has(rowId(row)));
  const allChosen = eligible.length > 0 && chosen.length === eligible.length;
  const togglePick = (row: Row) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(rowId(row))) next.add(rowId(row));
      return next;
    });
  const pickAll = () => setPicked(allChosen ? new Set() : new Set(eligible.map(rowId)));
  const makeChosenGlobal = () => {
    send({ type: 'makeSkillsGlobal', skills: chosen.map(globalRequest) });
    setPicked(new Set());
  };
  const statusCatalog = shown === ALL ? combinedStatus(catalogs, profiles) : catalog;
  const rescan = () => {
    for (const id of shown === ALL ? profiles.map((profile) => profile.id) : [agent])
      send({ type: 'refreshSkills', agent: id, force: true });
  };
  const openFolder = () => send({ type: 'openProfileFolder', id: agent, folder: 'skills' });

  return (
    <section
      aria-label="Skills"
      className="skills-page min-h-0 flex-1 overflow-y-auto scroll-pt-11 px-4 pt-6 pb-10 @container"
    >
      <div className="mx-auto max-w-[720px]">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 ref={heading} tabIndex={-1} className="m-0 text-base font-semibold outline-none">
              Skills
            </h1>
            <p className="mb-0 mt-1 text-xs text-muted-foreground">
              What each account can use in this project. Type <kbd>/</kbd> in a message to pick one,
              from this account or borrowed from another.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="xs" variant="secondary" onClick={rescan}>
              <Icon name="refresh" size={12} />
              Rescan
            </Button>
            <OverflowMenu
              items={[
                {
                  key: 'verify',
                  label: `Verify ${profileLabel(agent)} with the agent…`,
                  icon: <Icon name="check" size={14} />,
                  onSelect: () => send({ type: 'verifySkills', agent }),
                },
                {
                  key: 'folder',
                  label: `Open ${profileLabel(agent)}’s skills folder`,
                  icon: <Icon name="folder" size={14} />,
                  onSelect: openFolder,
                },
              ]}
            />
          </div>
        </header>

        <div
          role="tablist"
          aria-label="Skills view"
          className="mt-4 flex gap-4 border-b border-subtle"
          onKeyDown={(event) => moveTabFocus(event)}
        >
          {(['skills', 'configuration'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`${tabsId}-${item}`}
              aria-selected={view === item}
              aria-controls={`${tabsId}-panel`}
              tabIndex={view === item ? 0 : -1}
              className={TAB}
              onClick={() => setView(item)}
            >
              {item === 'skills' ? 'Skills' : 'Configuration'}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-${view}`}
          className="pt-4"
        >
          {/* Accounts first: every view below is about the chosen one. */}
          {/* biome-ignore lint/a11y/useSemanticElements: a row of toggle chips, not a form */}
          <div role="group" aria-label="Account" className="flex flex-wrap gap-1.5">
            {view === 'skills' ? (
              <button
                type="button"
                className={CHIP}
                aria-label={`All accounts, ${allCount} skills`}
                aria-pressed={shown === ALL}
                onClick={() => {
                  setScope(ALL);
                  setMissingOnly(false);
                }}
              >
                All accounts
                <Count value={allCount} />
              </button>
            ) : null}
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={CHIP}
                aria-label={
                  view === 'skills'
                    ? `${profile.label}, ${skillsFor(catalogs, profile.id).skills.length} skills`
                    : profile.label
                }
                aria-pressed={
                  view === 'configuration' ? agent === profile.id : shown === profile.id
                }
                onClick={() => {
                  setScope(profile.id);
                  setMissingOnly(false);
                }}
              >
                <AgentMark agent={profile.id} size={13} />
                {profile.label}
                {view === 'skills' ? (
                  <Count value={skillsFor(catalogs, profile.id).skills.length} />
                ) : null}
              </button>
            ))}
          </div>

          {view === 'configuration' ? (
            <div className="mt-4">
              <ConfigurationView agent={agent} cwd={cwd} session={session} />
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="relative min-w-[200px] flex-1">
                  <span className="sr-only">Search skills</span>
                  <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground">
                    <Icon name="search" size={13} />
                  </span>
                  <input
                    ref={searchBox}
                    type="search"
                    placeholder="Search skills…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && search) {
                        event.stopPropagation();
                        setSearch('');
                      }
                    }}
                    className="h-8 w-full rounded-md border border-strong bg-[var(--raised)] pl-7 pr-2 text-xs text-foreground focus-visible:border-[var(--focus)] focus-visible:outline-none"
                  />
                </label>
                {shown !== ALL && missing.length ? (
                  <button
                    type="button"
                    className={CHIP}
                    aria-pressed={missingOnly}
                    title={`Skills other accounts have that ${profileLabel(agent)} doesn’t, by name`}
                    onClick={() => setMissingOnly((value) => !value)}
                  >
                    Missing here
                    <Count value={missing.length} />
                  </button>
                ) : null}
              </div>

              <Status catalog={statusCatalog} cwd={cwd} all={shown === ALL} onRescan={rescan} />

              {missingOnly ? (
                <p className="mt-3 mb-0 text-[11.5px] text-muted-foreground">
                  In other accounts but not {profileLabel(agent)}, compared by name. Borrow one in a
                  message with <kbd>/</kbd>, or make it global so every account has it.
                </p>
              ) : null}

              {rows.length ? (
                <div className="mt-3">
                  <ListHeader
                    count={rows.length}
                    total={eligible.length}
                    chosen={chosen.length}
                    allChosen={allChosen}
                    onAll={pickAll}
                    onClear={() => setPicked(new Set())}
                    onGlobal={makeChosenGlobal}
                  />
                  {groups.map((group) => (
                    <section key={group.source} aria-label={GROUP_LABEL[group.source]}>
                      {groups.length > 1 ? (
                        <h2 className="m-0 mt-3 mb-1 px-2 text-[11px] font-medium text-muted-foreground">
                          {GROUP_LABEL[group.source]}{' '}
                          <span className="font-normal text-faint">{group.rows.length}</span>
                        </h2>
                      ) : null}
                      <ul className="m-0 list-none p-0">
                        {group.rows.map((row) => (
                          <SkillRow
                            key={`${row.owner}:${row.skill.path ?? row.skill.name}`}
                            row={row}
                            catalog={skillsFor(catalogs, row.owner)}
                            showAccounts={shown === ALL || missingOnly}
                            global={canMakeGlobal(row.skill, catalogs, profiles)}
                            picked={picked.has(rowId(row))}
                            onPick={() => togglePick(row)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <Empty
                  catalog={statusCatalog}
                  search={search}
                  agent={shown === ALL ? undefined : agent}
                  onClear={() => setSearch('')}
                  onRescan={rescan}
                  onFolder={openFolder}
                  onAll={() => setScope(ALL)}
                />
              )}

              {statusCatalog.problems.length ? (
                <details className="mt-4 rounded-md border border-subtle px-3 py-2 text-[11.5px]">
                  <summary className="cursor-pointer text-[var(--warning)]">
                    <Icon name="question" size={12} />{' '}
                    {statusCatalog.problems.length === 1
                      ? '1 skill couldn’t be read'
                      : `${statusCatalog.problems.length} skills couldn’t be read`}
                  </summary>
                  <ul className="mt-2 mb-0 space-y-1 pl-4 text-muted-foreground">
                    {statusCatalog.problems.map((problem) => (
                      <li key={problem} className="wrap-anywhere">
                        {problem}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The list's one header: a count, Select all, and the action for a selection. It sticks while
 * the list scrolls, so the action stays in reach.
 */
function ListHeader({
  count,
  total,
  chosen,
  allChosen,
  onAll,
  onClear,
  onGlobal,
}: {
  count: number;
  /** Rows Make global applies to. */
  total: number;
  chosen: number;
  allChosen: boolean;
  onAll: () => void;
  onClear: () => void;
  onGlobal: () => void;
}) {
  const all = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (all.current) all.current.indeterminate = chosen > 0 && !allChosen;
  }, [chosen, allChosen]);
  return (
    <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-subtle bg-canvas px-2 text-[12px]">
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        {total ? (
          <input
            ref={all}
            type="checkbox"
            checked={allChosen}
            onChange={onAll}
            aria-label={`Select all ${total} skills that can be made global`}
            className="size-3.5 cursor-pointer accent-[var(--accent)]"
          />
        ) : null}
      </span>
      <output className="min-w-0 flex-1 truncate text-muted-foreground">
        {chosen ? `${chosen} selected` : `${count} ${count === 1 ? 'skill' : 'skills'}`}
      </output>
      {chosen ? (
        <span className="inline-flex shrink-0 items-center gap-1">
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear
          </Button>
          <Button
            size="xs"
            variant="secondary"
            title="One shared copy each in ~/.agents/skills, linked into every Claude account. Every Codex account reads it already."
            onClick={onGlobal}
          >
            <Icon name="globe" size={12} />
            Make {chosen} global
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="text-[11px] tabular-nums text-faint">{value}</span>;
}

function Status({
  catalog,
  cwd,
  all,
  onRescan,
}: {
  catalog: SkillCatalog;
  cwd?: string;
  all: boolean;
  onRescan: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {cwd ? (
        <span className="min-w-0 max-w-full truncate" title={cwd}>
          <Icon name="folder" size={11} /> {cwd}
        </span>
      ) : null}
      <details className="group">
        <summary className="cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-foreground">
          How skills are found
        </summary>
        <p className="mt-1 mb-0 max-w-[60ch] leading-relaxed">
          Files are read without running {all ? 'any agent' : 'the agent'}. “Found on disk” means a
          file exists, not that the agent will load it. Verify with the agent asks the CLI itself;
          that can run configured hooks and connect servers. Bundled, managed and plugin skills may
          only appear after verifying.
        </p>
      </details>
      {catalog.stale ? (
        <output className="inline-flex items-center gap-1.5 text-[var(--warning)]">
          These results may be out of date.
          <button type="button" className="underline underline-offset-2" onClick={onRescan}>
            Rescan
          </button>
        </output>
      ) : null}
      {catalog.status === 'loading' ? <output>Looking for skills…</output> : null}
    </div>
  );
}

function Empty({
  catalog,
  search,
  agent,
  onClear,
  onRescan,
  onFolder,
  onAll,
}: {
  catalog: SkillCatalog;
  search: string;
  agent?: AgentKind;
  onClear: () => void;
  onRescan: () => void;
  onFolder: () => void;
  onAll: () => void;
}) {
  if (catalog.status === 'loading' || catalog.status === 'idle')
    return (
      <div aria-hidden className="space-y-2 py-2">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-10 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  if (catalog.status === 'error')
    return (
      <div role="alert" className="rounded-md border border-strong p-3 text-xs">
        <p className="m-0 text-error wrap-anywhere">
          {catalog.error ?? 'Couldn’t read this account’s skills.'}
        </p>
        <Button className="mt-2" size="xs" variant="secondary" onClick={onRescan}>
          Try again
        </Button>
      </div>
    );
  if (search)
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        <p className="m-0">No skills match “{search}”.</p>
        <div className="mt-2 flex justify-center gap-2">
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear search
          </Button>
          {agent ? (
            <Button size="xs" variant="ghost" onClick={onAll}>
              Search all accounts
            </Button>
          ) : null}
        </div>
      </div>
    );
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      <p className="m-0">
        {agent ? `${profileLabel(agent)} has no skills in this project yet.` : 'No skills yet.'}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button size="xs" variant="secondary" onClick={onRescan}>
          Rescan
        </Button>
        {agent ? (
          <>
            <Button size="xs" variant="ghost" onClick={onFolder}>
              Open skills folder
            </Button>
            <Button size="xs" variant="ghost" onClick={onAll}>
              Show all accounts
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Shown on hover or keyboard focus, and always while the row is picked or open. */
const ROW_ACTIONS =
  'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[active=true]/row:opacity-100 @max-[480px]:opacity-100';

function SkillRow({
  row,
  catalog,
  showAccounts,
  global,
  picked,
  onPick,
}: {
  row: Row;
  /** The owner's catalog, which decides whether it can be turned on or off here. */
  catalog: SkillCatalog;
  showAccounts: boolean;
  /** Whether Make global has something to do for this skill. */
  global: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const { skill, owner } = row;
  const canToggle =
    CAPABILITIES[agentTarget(owner).provider].skillToggle &&
    Boolean(skill.path) &&
    skill.evidence === 'native' &&
    !catalog.stale &&
    catalog.status === 'ready';
  const off = skill.enabled === false;
  return (
    <li
      className="group/row rounded-md hover:bg-muted focus-within:bg-muted data-[active=true]:bg-muted"
      data-active={picked || open}
    >
      <div className="flex min-h-9 items-center gap-2 px-2">
        {/* A fixed slot, so names line up whether or not a row can be picked. */}
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          {global ? (
            <input
              type="checkbox"
              checked={picked}
              onChange={onPick}
              aria-label={`Select ${skill.name}`}
              className="size-3.5 cursor-pointer accent-[var(--accent)]"
            />
          ) : null}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          title={open ? 'Hide details' : 'Show details'}
          className="flex min-w-[5.5rem] shrink items-center justify-start gap-1.5 rounded-sm py-1.5 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <span
            aria-hidden="true"
            className={`inline-flex shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          >
            <Icon name="chevron" size={12} />
          </span>
          <span
            className={`truncate text-[12.5px] font-medium ${off ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {skill.name}
          </span>
        </button>
        <span className="inline-flex shrink-0 items-center gap-1">
          {off ? <Badge>Off</Badge> : null}
          {skill.global ? (
            <Badge title="Global: its folder is in ~/.agents/skills, shared by accounts">
              <Icon name="globe" size={10} />
              <span className="@max-[480px]:sr-only">Global</span>
            </Badge>
          ) : null}
          {showAccounts ? (
            <span
              className="inline-flex items-center gap-0.5 @max-[480px]:hidden"
              title={`In ${row.in.map(profileLabel).join(', ')}`}
            >
              <span className="sr-only">In {row.in.map(profileLabel).join(', ')}</span>
              {row.in.map((id) => (
                <AgentMark key={id} agent={id} size={12} />
              ))}
            </span>
          ) : null}
        </span>
        {/* One line here; the full text is in the details. */}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground @max-[480px]:hidden">
          {skill.description}
        </span>
        <span className={`${ROW_ACTIONS} @max-[480px]:ml-auto`}>
          {global ? (
            <Hint label="Make global">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Make ${skill.name} global`}
                onClick={() => send({ type: 'makeSkillsGlobal', skills: [globalRequest(row)] })}
              >
                <Icon name="globe" size={13} />
              </Button>
            </Hint>
          ) : null}
          {skill.path ? (
            <Hint label="Open SKILL.md">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Open ${skill.name}`}
                onClick={() =>
                  send({
                    type: 'openSkill',
                    agent: owner,
                    name: skill.name,
                    path: skill.path ?? '',
                  })
                }
              >
                <Icon name="external" size={13} />
              </Button>
            </Hint>
          ) : null}
          {canToggle ? (
            <Button
              variant="ghost"
              size="xs"
              aria-label={`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`}
              onClick={() =>
                send({
                  type: 'setSkillEnabled',
                  agent: owner,
                  name: skill.name,
                  path: skill.path ?? '',
                  enabled: !skill.enabled,
                })
              }
            >
              {skill.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          ) : null}
        </span>
      </div>
      {open ? (
        <div id={detailId} className="pb-2.5 pl-[3.25rem] pr-2 text-[11.5px] text-muted-foreground">
          {skill.description ? (
            <p className="m-0 whitespace-pre-wrap leading-[1.5]">{skill.description}</p>
          ) : null}
          <dl className="mt-1.5 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-faint">Evidence</dt>
            <dd className="m-0">
              {skill.evidence === 'disk'
                ? 'Found on disk · availability unverified'
                : 'Native catalog · current session unverified'}
            </dd>
            {skill.source ? (
              <>
                <dt className="text-faint">Source</dt>
                <dd className="m-0">{SKILL_SOURCE_LABELS[skill.source]}</dd>
              </>
            ) : null}
            <dt className="text-faint">Accounts</dt>
            <dd className="m-0">{row.in.map(profileLabel).join(', ')}</dd>
            {skill.argumentHint ? (
              <>
                <dt className="text-faint">Arguments</dt>
                <dd className="m-0">{skill.argumentHint}</dd>
              </>
            ) : null}
            {skill.path ? (
              <>
                <dt className="text-faint">File</dt>
                <dd className="m-0 wrap-anywhere">{skill.path}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </li>
  );
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded border border-subtle px-1 text-[10.5px] leading-4 text-muted-foreground"
    >
      {children}
    </span>
  );
}
