import { type ReactNode, useState } from 'react';
import { dayTitle, type PageEntry } from '../../../../shared/model';
import { Icon, type IconName } from '../../../components/icons';
import { Hint, OverflowMenu } from '../../../components/menus';
import { post } from '../shared/page-bridge';

export function TodayRow({
  day,
  page,
  active,
}: {
  day: string;
  page?: PageEntry;
  active: boolean;
}) {
  const open = page?.openTasks ?? 0;
  const done = page?.doneTasks ?? 0;
  return (
    <button
      type="button"
      data-active={active}
      onClick={() => post({ type: 'pageToday' })}
      className="mb-2 flex w-full items-center gap-2.5 rounded-lg border border-subtle bg-surface px-2.5 py-2 text-left hover:bg-muted data-[active=true]:border-strong"
    >
      <Icon name="today" size={15} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Today</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{dayTitle(day)}</span>
      </span>
      {page && open + done ? (
        <span
          className="shrink-0 text-[11.5px] text-muted-foreground"
          title={`${done} of ${open + done} tasks done`}
        >
          {done}/{open + done}
        </span>
      ) : null}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-2">
      <h2 className="m-0 px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-faint">{title}</h2>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}
export function Fold({
  title,
  count,
  children,
  open: initial = false,
  nested,
}: {
  title: string;
  count: number;
  children: ReactNode;
  open?: boolean;
  nested?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={nested ? '' : 'mb-2'}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-medium text-faint hover:text-muted-foreground"
      >
        <span
          className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        >
          <Icon name="chevron" size={11} />
        </span>
        {title}
        <span className="font-normal">{count}</span>
      </button>
      {open ? <ul className="m-0 list-none p-0">{children}</ul> : null}
    </section>
  );
}

/** Renames a page in place: Enter or leaving the field saves, Escape keeps the old name. */
export function RenameField({
  page,
  onDone,
  className = 'm-0.5 w-full',
}: {
  page: PageEntry;
  onDone: () => void;
  className?: string;
}) {
  const [title, setTitle] = useState(page.title);
  const save = () => {
    const clean = title.trim();
    if (clean && clean !== page.title) post({ type: 'pageRename', id: page.id, title: clean });
    onDone();
  };
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: renaming was just asked for
      autoFocus
      value={title}
      aria-label="Page name"
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') onDone();
      }}
      className={`${className} rounded border border-ring bg-raised px-1.5 py-[3px] text-[13px] outline-none`}
    />
  );
}

/** What you can do with a page from a list: the same everywhere pages are listed. */
export function pageActions(page: PageEntry, rename: () => void) {
  const action = (key: string, label: string, icon: IconName, onSelect: () => void) => ({
    key,
    label,
    icon: <Icon name={icon} size={13} />,
    onSelect,
  });
  return [
    action('rename', 'Rename', 'edit', rename),
    action('pin', page.pinned ? 'Unpin' : 'Pin', 'pin', () =>
      post({ type: 'pagePin', id: page.id, pinned: !page.pinned }),
    ),
    action('duplicate', 'Duplicate', 'copy', () => post({ type: 'pageDuplicate', id: page.id })),
    action('text', 'Open as Markdown', 'file', () => post({ type: 'pageOpenText', id: page.id })),
    action('trash', 'Move to trash', 'trash', () => post({ type: 'pageTrash', id: page.id })),
  ];
}

export function PageRow({
  page,
  active,
  renaming,
  onRename,
  detail,
}: {
  page: PageEntry;
  active: boolean;
  renaming: boolean;
  onRename: (on: boolean) => void;
  detail?: ReactNode;
}) {
  return (
    <li
      data-active={active}
      className="group relative flex items-center rounded-md hover:bg-muted data-[active=true]:bg-muted"
    >
      {renaming ? (
        <RenameField page={page} onDone={() => onRename(false)} />
      ) : (
        <button
          type="button"
          onClick={() => post({ type: 'pageOpen', id: page.id })}
          onKeyDown={(event) => {
            if (event.key === 'F2') onRename(true);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-[5px] text-left"
        >
          <span className="w-4 shrink-0 text-center text-[13px]" aria-hidden="true">
            {page.icon ?? <Icon name="page" size={13} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{page.title}</span>
            {detail}
          </span>
          {page.by === 'agent' ? (
            <span className="shrink-0 text-[11px] text-faint" title="An agent wrote this page">
              agent
            </span>
          ) : null}
          {page.openTasks ? (
            <span
              className="shrink-0 text-[11px] text-faint group-hover:hidden"
              title={`${page.openTasks} open ${page.openTasks === 1 ? 'task' : 'tasks'}`}
            >
              {page.openTasks}
            </span>
          ) : null}
        </button>
      )}
      {!renaming ? (
        <span className="absolute right-0.5 hidden group-focus-within:flex group-hover:flex">
          <OverflowMenu items={pageActions(page, () => onRename(true))} />
        </span>
      ) : null}
    </li>
  );
}

export function TrashRow({ page }: { page: PageEntry }) {
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-[5px] text-muted-foreground hover:bg-muted">
      <span className="w-4 shrink-0 text-center" aria-hidden="true">
        {page.icon ?? <Icon name="page" size={13} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{page.title}</span>
      <Hint label="Restore">
        <button
          type="button"
          aria-label={`Restore ${page.title}`}
          onClick={() => post({ type: 'pageRestore', id: page.id })}
          className="grid size-6 place-items-center rounded-md hover:bg-raised hover:text-foreground"
        >
          <Icon name="restore" size={13} />
        </button>
      </Hint>
      <Hint label="Delete forever">
        <button
          type="button"
          aria-label={`Delete ${page.title} forever`}
          onClick={() => post({ type: 'pageDeleteForever', id: page.id })}
          className="grid size-6 place-items-center rounded-md hover:bg-raised hover:text-foreground"
        >
          <Icon name="trash" size={13} />
        </button>
      </Hint>
    </li>
  );
}

export function Empty() {
  return (
    <div className="px-2 py-3 text-[12.5px] leading-[1.5] text-muted-foreground">
      <p className="m-0 mb-1 text-foreground">Your notes, next to your agents.</p>
      <p className="m-0">
        Pages are Markdown, kept for this workspace. Write tasks and plans, then ask Claude or Codex
        to work on them.
      </p>
    </div>
  );
}
