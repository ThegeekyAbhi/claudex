import { useEffect, useId, useRef, useState } from 'react';
import {
  type AgentKind,
  profileLabel,
  SKILL_SOURCE_LABELS,
  type Skill,
  type SkillCatalogs,
  searchOtherSkills,
  searchSkills,
  skillsFor,
} from '../../../shared/model';
import { AgentMark, Icon } from '../../components/icons';
import { type MenuAnchor, menuAnchorStyle } from '../../lib/caret';

/** Other accounts can match a lot; the menu is for picking, the Skills page for browsing. */
const MAX_OTHER = 30;
const ROW =
  'menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-[7px] py-[3px] rounded-[5px] cursor-pointer text-left select-none outline-none data-[active=true]:bg-muted';
const LABEL = 'context-label shrink-0 max-w-[70%] truncate text-[12.5px]';
const GROUP = 'px-[7px] pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground';

/** Built-in commands, run by this extension rather than sent to the agent as text. */
export const COMMANDS: Skill[] = [
  {
    name: 'btw',
    description:
      'Ask a side question about this conversation. Answered without tools and kept out of the thread.',
    enabled: true,
  },
];
interface Row {
  skill: Skill;
  /** A built-in command, not a skill. */
  command?: boolean;
  /** Set for a skill read from another account. */
  from?: AgentKind;
  alsoIn?: AgentKind[];
}

/** Which accounts a borrowed skill is in; otherwise where this account's skill comes from. */
function rowDetail(row: Row): string {
  if (row.command) return 'Command';
  if (row.from) return [row.from, ...(row.alsoIn ?? [])].map(profileLabel).join(' · ');
  if (row.skill.source) return SKILL_SOURCE_LABELS[row.skill.source];
  return row.skill.description;
}

/**
 * The `/` menu. Reads catalogs the host already has, so typing never waits on a CLI. This
 * account's skills come first; while searching, other accounts' skills follow, to borrow.
 */
export function SkillMenu({
  agent,
  catalogs,
  query,
  anchor,
  onPick,
  onCommand,
  onManage,
  onClose,
  keyHandler,
}: {
  agent: AgentKind;
  catalogs: SkillCatalogs;
  query: string;
  anchor: MenuAnchor;
  onPick: (skill: Skill, from?: AgentKind) => void;
  /** Set where commands apply: in a thread, not when starting one. */
  onCommand?: (name: string) => void;
  onManage: () => void;
  onClose: () => void;
  keyHandler: { current: ((event: React.KeyboardEvent) => boolean) | null };
}) {
  const menuId = useId();
  const catalog = skillsFor(catalogs, agent);
  const commands: Row[] = onCommand
    ? COMMANDS.filter((command) => command.name.startsWith(query.toLowerCase())).map((skill) => ({
        skill,
        command: true,
      }))
    : [];
  const own: Row[] = [
    ...commands,
    ...searchSkills(catalog.skills, query).map((skill) => ({ skill })),
  ];
  // A bare `/` stays about this account, unless it has nothing to offer.
  const others: Row[] =
    query || (catalog.status === 'ready' && !own.length)
      ? searchOtherSkills(catalogs, agent, query).slice(0, MAX_OTHER)
      : [];
  const rows = [...own, ...others];
  const manageIndex = rows.length;
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top
  useEffect(() => setActive(0), [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the highlighted row
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const pick = (row: Row) =>
    row.command ? onCommand?.(row.skill.name) : onPick(row.skill, row.from);
  keyHandler.current = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + rows.length + 1) % (rows.length + 1));
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (active === manageIndex) {
        onManage();
        return true;
      }
      const row = rows[active];
      if (row) pick(row);
      return Boolean(row) || event.key === 'Tab';
    }
    if (event.key === 'Escape') {
      onClose();
      return true;
    }
    return false;
  };
  const highlighted = rows[active];
  useEffect(() => {
    const input = document.activeElement;
    if (!(input instanceof HTMLTextAreaElement)) return;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', menuId);
    input.setAttribute('aria-activedescendant', `${menuId}-${active}`);
    return () => {
      for (const name of [
        'role',
        'aria-expanded',
        'aria-autocomplete',
        'aria-controls',
        'aria-activedescendant',
      ])
        input.removeAttribute(name);
    };
  }, [menuId, active]);
  const empty =
    catalog.status === 'error'
      ? `Couldn’t read ${profileLabel(agent)}’s skills.`
      : catalog.status === 'ready'
        ? query
          ? `No matching skills in ${profileLabel(agent)}.`
          : `${profileLabel(agent)} has no skills here yet.`
        : 'Looking for skills…';
  const option = (row: Row, index: number) => (
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the textarea while the list is open
    <div
      key={`${row.from ?? ''}:${row.skill.path ?? row.skill.name}`}
      id={`${menuId}-${index}`}
      role="option"
      aria-selected={index === active}
      className={ROW}
      data-active={index === active}
      onPointerMove={() => setActive(index)}
      onPointerDown={(event) => {
        event.preventDefault();
        pick(row);
      }}
    >
      {row.from ? (
        <AgentMark agent={row.from} size={13} />
      ) : (
        <Icon name={row.command ? 'aside' : 'skill'} size={13} />
      )}
      <span className={LABEL}>{row.command ? `/${row.skill.name}` : row.skill.name}</span>
      <span className="flex-1 min-w-0 truncate text-right text-[11px] text-faint">
        {rowDetail(row)}
      </span>
    </div>
  );
  return (
    <div
      className={`absolute z-40 flex gap-1.5 ${anchor.bottom === undefined ? 'items-start' : 'items-end'}`}
      style={menuAnchorStyle(anchor)}
    >
      <div
        className="bg-overlay border border-strong rounded-lg [box-shadow:var(--shadow)] w-[min(380px,100vw-32px)] max-h-[var(--menu-max-h)] overflow-y-auto p-1 shrink-0"
        ref={list}
        id={menuId}
        role="listbox"
        aria-label="Skills"
      >
        {others.length ? (
          // biome-ignore lint/a11y/useSemanticElements: a group inside a listbox, not a fieldset
          <div role="group" aria-labelledby={`${menuId}-own`}>
            <div id={`${menuId}-own`} className={GROUP}>
              {profileLabel(agent)}
            </div>
            {own.map(option)}
            {!own.length ? (
              <div className="px-[7px] py-1 text-[11.5px] text-muted-foreground">{empty}</div>
            ) : null}
          </div>
        ) : (
          own.map(option)
        )}
        {!rows.length ? (
          <div className="flex items-center gap-[7px] p-[7px] text-[11.5px] text-muted-foreground">
            {empty}
          </div>
        ) : null}
        {others.length ? (
          // biome-ignore lint/a11y/useSemanticElements: a group inside a listbox, not a fieldset
          <div role="group" aria-labelledby={`${menuId}-others`}>
            <div id={`${menuId}-others`} className={`${GROUP} mt-1 border-t border-subtle`}>
              Other accounts · borrow for this message
            </div>
            {others.map((row, index) => option(row, own.length + index))}
          </div>
        ) : null}
        {catalog.problems.length ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {catalog.problems.length === 1
              ? '1 skill couldn’t be read.'
              : `${catalog.problems.length} skills couldn’t be read.`}{' '}
            See Manage skills.
          </div>
        ) : null}
        {/* Pinned, so what the highlighted skill does and Manage skills stay in view. */}
        <div className="sticky bottom-0 -mx-1 -mb-1 mt-1 border-t border-subtle bg-overlay px-1 pb-1">
          {/* One line, so a long description can never cover the list it describes. */}
          {highlighted?.skill.description ? (
            <output
              className="block truncate px-2 pt-1.5 pb-1 text-[11.5px] text-muted-foreground"
              title={highlighted.skill.description}
            >
              {highlighted.skill.description}
            </output>
          ) : null}
          <div
            role="option"
            id={`${menuId}-${manageIndex}`}
            aria-selected={active === manageIndex}
            data-active={active === manageIndex}
            onPointerMove={() => setActive(manageIndex)}
            tabIndex={-1}
            className={`${ROW} text-muted-foreground`}
            onPointerDown={(event) => {
              event.preventDefault();
              onManage();
            }}
          >
            <Icon name="wrench" size={13} />
            <span className={LABEL}>Manage skills…</span>
            <span className="ml-auto text-[11px] text-faint">Skills page</span>
          </div>
        </div>
      </div>
    </div>
  );
}
