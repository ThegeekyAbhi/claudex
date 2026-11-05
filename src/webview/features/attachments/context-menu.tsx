import { useEffect, useRef, useState } from 'react';
import {
  AGENT_LABELS,
  type AgentKind,
  type Attachment,
  attachmentLabel,
  IMAGE_EXTENSION,
  type Session,
} from '../../../core/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon, type IconName } from '../../components/icons';
import { useImageUrl } from '../images/image-view';

export interface ContextResults {
  requestId: number;
  matches: { kind: 'file' | 'folder'; path: string }[];
  recent: string[];
  terminals: string[];
}
const AGENTS: { name: string; agent: AgentKind }[] = [
  { name: 'claude', agent: 'claude' },
  { name: 'claude2', agent: 'claud2' },
  { name: 'codex', agent: 'codex' },
];
export interface Trigger {
  mark: '@' | '#' | '/';
  query: string;
  start: number;
  end: number;
}
/** The `@query`, `#query` or `/query` the caret is in, if any. An email address does not count. */
export function triggerAt(text: string, caret: number): Trigger | undefined {
  const match = /(?:^|\s)([@#/])([^\s@#/]*)$/.exec(text.slice(0, caret));
  if (!match) return undefined;
  const end = caret;
  return {
    mark: match[1] as Trigger['mark'],
    query: match[2],
    start: end - match[2].length - 1,
    end,
  };
}
type View = 'root' | 'files' | 'threads' | 'terminals';
interface Row {
  key: string;
  label: string;
  detail?: string;
  icon?: IconName;
  agent?: AgentKind;
  more?: boolean;
  path?: string;
  run: () => void;
}
function fileIcon(path: string, kind: 'file' | 'folder'): IconName {
  if (kind === 'folder') return 'folder';
  return IMAGE_EXTENSION.test(path) ? 'image' : 'file';
}
function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}
export function ContextMenu({
  trigger,
  results,
  project,
  sessions,
  currentId,
  below,
  leading,
  onAgent,
  onAttach,
  onImages,
  onClose,
  keyHandler,
}: {
  trigger: Trigger;
  results?: ContextResults;
  project: string;
  sessions: Session[];
  currentId?: string;
  below: boolean;
  /** At the very start of a message, an @name can run an agent. */
  leading: boolean;
  onAgent: (name: string) => void;
  onAttach: (attachment: Attachment) => void;
  onImages: () => void;
  onClose: () => void;
  keyHandler: { current: ((event: React.KeyboardEvent) => boolean) | null };
}) {
  const [view, setView] = useState<View>(trigger.mark === '#' ? 'files' : 'root');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const query = trigger.query.toLowerCase();
  const fileRow = (path: string, kind: 'file' | 'folder'): Row => ({
    key: `${kind}:${path}`,
    label: path.split('/').pop() || path,
    detail: parentOf(path),
    icon: fileIcon(path, kind),
    path,
    run: () => onAttach({ kind, path }),
  });
  const threads = sessions.filter(
    (item) => item.id !== currentId && item.title.toLowerCase().includes(query),
  );
  const threadRows: Row[] = threads.slice(0, 12).map((item) => ({
    key: `thread:${item.id}`,
    label: item.title,
    icon: 'thread',
    run: () => onAttach({ kind: 'thread', id: item.id, title: item.title }),
  }));
  const terminals = results?.terminals ?? [];
  const terminalRows: Row[] = terminals
    .filter((name) => name.toLowerCase().includes(query))
    .map((name) => ({
      key: `terminal:${name}`,
      label: name,
      detail: 'Last command and its output',
      icon: 'terminal',
      run: () => onAttach({ kind: 'terminal', name }),
    }));
  function buildRows(): Row[] {
    const matches = (results?.matches ?? []).map((item) => fileRow(item.path, item.kind));
    if (view === 'files') return matches;
    if (view === 'threads') return threadRows;
    if (view === 'terminals') return terminalRows;
    const agents = leading
      ? AGENTS.filter((item) => item.name.startsWith(query)).map(
          (item): Row => ({
            key: `agent:${item.name}`,
            label: `@${item.name}`,
            detail: `Run ${AGENT_LABELS[item.agent]}`,
            agent: item.agent,
            run: () => onAgent(item.name),
          }),
        )
      : [];
    const top = query
      ? matches.slice(0, 6)
      : (results?.recent ?? []).slice(0, 3).map((path) => fileRow(path, 'file'));
    const categories: Row[] = [
      {
        key: 'files',
        label: 'Files & Folders',
        icon: 'folderOpen',
        more: true,
        run: () => setView('files'),
      },
      {
        key: 'threads',
        label: 'Past Threads',
        icon: 'thread',
        more: true,
        run: () => setView('threads'),
      },
      ...(terminals.length
        ? [
            {
              key: 'terminals',
              label: 'Terminals',
              icon: 'terminal' as const,
              more: true,
              run: () => setView('terminals'),
            },
          ]
        : []),
      {
        key: 'diff',
        label: 'Branch (Diff with Main)',
        icon: 'branch',
        run: () => onAttach({ kind: 'diff' }),
      },
      { key: 'images', label: 'Images', icon: 'image', run: onImages },
    ];
    return [
      ...agents,
      ...top,
      ...categories.filter((item) => !query || item.label.toLowerCase().includes(query)),
    ];
  }
  const rows = buildRows();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed list starts from its top
  useEffect(() => setActive(0), [rows.length, view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling follows the active row
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  keyHandler.current = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((active + step + rows.length) % rows.length);
      }
      return true;
    }
    if (
      event.key === 'Enter' ||
      event.key === 'Tab' ||
      (event.key === 'ArrowRight' && rows[active]?.more)
    ) {
      if (rows[active]) rows[active].run();
      return event.key !== 'Enter' || Boolean(rows[active]);
    }
    if (event.key === 'ArrowLeft' && view !== 'root' && trigger.mark === '@') {
      setView('root');
      return true;
    }
    if (event.key === 'Escape') {
      onClose();
      return true;
    }
    return false;
  };
  const highlighted = rows[active]?.path;
  const crumbs = highlighted?.split('/') ?? [];
  return (
    <div
      className={`absolute bottom-[calc(100%+6px)] left-0 z-40 flex items-start gap-1.5 max-w-full [&.below]:bottom-auto [&.below]:top-[calc(100%+6px)] ${below ? 'below' : ''}`}
    >
      <div
        className="bg-overlay border border-strong rounded-lg [box-shadow:var(--shadow)] w-[min(420px,100vw-32px)] max-h-80 overflow-y-auto p-1 shrink-0"
        ref={list}
        role="listbox"
        aria-label="Add context"
      >
        {view !== 'root' && trigger.mark === '@' ? (
          <button
            type="button"
            className="w-full justify-start px-[7px] py-[3px] text-[11px] text-muted-foreground"
            onPointerDown={(event) => {
              event.preventDefault();
              setView('root');
            }}
          >
            ‹{' '}
            {view === 'files'
              ? 'Files & Folders'
              : view === 'threads'
                ? 'Past Threads'
                : 'Terminals'}
          </button>
        ) : null}
        {rows.map((row, index) => (
          // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the textarea while the list is open
          <div
            key={row.key}
            role="option"
            aria-selected={index === active}
            className={`menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-[7px] py-[3px] rounded-[5px] cursor-pointer text-left select-none outline-none data-[selected=true]:bg-muted data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint ${row.more ? 'category' : ''}`}
            data-active={index === active}
            onPointerMove={() => setActive(index)}
            onPointerDown={(event) => {
              event.preventDefault();
              row.run();
            }}
          >
            {row.agent ? (
              <AgentMark agent={row.agent} />
            ) : row.icon ? (
              <Icon name={row.icon} size={14} />
            ) : null}
            <span className="context-label shrink-0 max-w-[70%] truncate text-[12.5px] in-[.menu-item.category]:flex-1">
              {row.label}
            </span>
            {row.detail ? (
              <span className="flex-1 min-w-0 truncate [direction:rtl] text-right text-[11px] text-faint">
                {row.detail}
              </span>
            ) : null}
            {row.more ? <Icon name="chevron" size={11} /> : null}
          </div>
        ))}
        {!rows.length ? (
          <div className="flex items-center gap-[7px] p-[7px] text-[11.5px] text-muted-foreground">
            {results ? 'No matches.' : 'Searching…'}
          </div>
        ) : null}
      </div>
      {highlighted ? (
        <div
          className="bg-overlay border border-strong rounded-lg [box-shadow:var(--shadow)] px-2.5 py-2 text-[11.5px] text-muted-foreground max-w-[280px] overflow-hidden [&>div]:flex [&>div]:items-center [&>div]:gap-[5px] [&>div]:min-h-5 [&>div]:whitespace-nowrap max-[760px]:hidden"
          aria-hidden="true"
        >
          <div>
            <Icon name="folder" size={13} /> {project}/
          </div>
          {crumbs.map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: path segments can repeat
            <div key={index} className="" style={{ paddingLeft: (index + 1) * 12 }}>
              <Icon
                name={index === crumbs.length - 1 ? fileIcon(part, 'file') : 'folder'}
                size={13}
              />
              {part}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
export function AttachmentChip({
  attachment,
  muted,
  onRemove,
}: {
  attachment: Attachment;
  muted?: boolean;
  onRemove?: () => void;
}) {
  const url = useImageUrl(attachment.kind === 'image' ? attachment.file : undefined);
  const icon: IconName =
    attachment.kind === 'folder'
      ? 'folder'
      : attachment.kind === 'image'
        ? 'image'
        : attachment.kind === 'thread'
          ? 'thread'
          : attachment.kind === 'diff'
            ? 'branch'
            : attachment.kind === 'terminal'
              ? 'terminal'
              : attachment.kind === 'skill'
                ? 'wrench'
                : 'file';
  const title =
    attachment.kind === 'file' || attachment.kind === 'folder'
      ? attachment.path
      : attachment.kind === 'skill'
        ? `Skill you asked for: ${attachment.name}`
        : attachmentLabel(attachment);
  return (
    <span
      className={`attachment-chip inline-flex items-center gap-1 max-w-[220px] min-h-[22px] py-px pr-1 pl-1.5 border border-subtle rounded-md bg-surface text-[11.5px] text-muted-foreground [&>span]:min-w-0 [&>span]:truncate [&>span]:text-foreground [&_img]:size-[18px] [&_img]:object-cover [&_img]:rounded-[3px] [&_button]:p-0.5 [&_button]:text-muted-foreground [&_button]:shrink-0 ${muted ? 'opacity-50' : ''}`}
      title={title}
    >
      {url ? <img src={url} alt="" /> : <Icon name={icon} size={12} />}
      <span>{attachmentLabel(attachment)}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${attachmentLabel(attachment)}`}
          onClick={onRemove}
        >
          <Icon name="close" size={11} />
        </button>
      ) : null}
    </span>
  );
}
export function requestContext(requestId: number, query: string): void {
  send({ type: 'searchContext', requestId, query });
}
