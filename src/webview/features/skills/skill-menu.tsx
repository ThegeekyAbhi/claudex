import { useEffect, useId, useRef, useState } from 'react';
import {
  AGENT_LABELS,
  type AgentKind,
  SKILL_SOURCE_LABELS,
  type Skill,
  type SkillCatalog,
  searchSkills,
} from '../../../core/model';
import { Icon } from '../../components/icons';

/** The `/` menu. Reads the catalog the host already has, so typing never waits on a CLI. */
import { type MenuAnchor, menuAnchorStyle } from '../../lib/caret';
export function SkillMenu({
  agent,
  catalog,
  query,
  anchor,
  onPick,
  onManage,
  onClose,
  keyHandler,
}: {
  agent: AgentKind;
  catalog: SkillCatalog;
  query: string;
  anchor: MenuAnchor;
  onPick: (skill: Skill) => void;
  onManage: () => void;
  onClose: () => void;
  keyHandler: { current: ((event: React.KeyboardEvent) => boolean) | null };
}) {
  const menuId = useId();
  const rows = searchSkills(catalog.skills, query);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top
  useEffect(() => setActive(0), [query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the highlighted row
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  keyHandler.current = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + rows.length + 1) % (rows.length + 1));
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (active === rows.length) {
        onManage();
        return true;
      }
      const row = rows[active];
      if (row) onPick(row);
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
      ? `Couldn’t read ${AGENT_LABELS[agent]}’s skills.`
      : catalog.status === 'ready'
        ? query
          ? 'No matching skills.'
          : `${AGENT_LABELS[agent]} has no skills here yet.`
        : 'Looking for skills…';
  return (
    <div
      className={`absolute z-40 flex gap-1.5 ${anchor.bottom === undefined ? 'items-start' : 'items-end'}`}
      style={menuAnchorStyle(anchor)}
    >
      <div
        className="bg-overlay border border-strong rounded-lg [box-shadow:var(--shadow)] w-[min(360px,100vw-32px)] max-h-[var(--menu-max-h)] overflow-y-auto p-1 shrink-0"
        ref={list}
        id={menuId}
        role="listbox"
        aria-label="Skills"
      >
        {rows.map((row, index) => (
          // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the textarea while the list is open
          <div
            key={row.path ?? row.name}
            id={`${menuId}-${index}`}
            role="option"
            aria-selected={index === active}
            className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-[7px] py-[3px] rounded-[5px] cursor-pointer text-left select-none outline-none data-[selected=true]:bg-muted data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint"
            data-active={index === active}
            onPointerMove={() => setActive(index)}
            onPointerDown={(event) => {
              event.preventDefault();
              onPick(row);
            }}
          >
            <Icon name="skill" size={13} />
            <span className="context-label shrink-0 max-w-[70%] truncate text-[12.5px] in-[.menu-item.category]:flex-1">
              {row.name}
            </span>
            <span className="flex-1 min-w-0 truncate [direction:rtl] text-right text-[11px] text-faint">
              {row.source ? SKILL_SOURCE_LABELS[row.source] : row.description}
            </span>
          </div>
        ))}
        {!rows.length ? (
          <div className="flex items-center gap-[7px] p-[7px] text-[11.5px] text-muted-foreground">
            {empty}
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
        {highlighted?.description ? (
          <output className="block px-2 py-1 text-[11.5px] text-muted-foreground">
            {highlighted.description}
          </output>
        ) : null}
        <div
          role="option"
          id={`${menuId}-${rows.length}`}
          aria-selected={active === rows.length}
          data-active={active === rows.length}
          onPointerMove={() => setActive(rows.length)}
          tabIndex={-1}
          className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-[7px] py-[3px] rounded-[5px] cursor-pointer text-left select-none outline-none data-[selected=true]:bg-muted data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint text-muted-foreground"
          onPointerDown={(event) => {
            event.preventDefault();
            onManage();
          }}
        >
          <span className="context-label shrink-0 max-w-[70%] truncate text-[12.5px] in-[.menu-item.category]:flex-1">
            Manage skills…
          </span>
        </div>
      </div>
    </div>
  );
}
