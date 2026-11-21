import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../../../components/icons';
import { Hint } from '../../../../components/menus';
import type { BlockKind, MarkKind, SelectionState } from '../../editor/types';
import { SmallButton } from '../../shared/small-button';
import { ASK_PRESETS } from './ask-presets';

const BLOCKS: { kind: BlockKind; label: string; glyph: ReactNode }[] = [
  { kind: 'text', label: 'Text', glyph: <span className="text-[13px] font-medium">T</span> },
  { kind: 'h1', label: 'Heading 1', glyph: <span className="text-[11px] font-semibold">H1</span> },
  { kind: 'h2', label: 'Heading 2', glyph: <span className="text-[11px] font-semibold">H2</span> },
  { kind: 'h3', label: 'Heading 3', glyph: <span className="text-[11px] font-semibold">H3</span> },
  { kind: 'todo', label: 'To-do list', glyph: <Icon name="tasks" size={14} /> },
  { kind: 'bullet', label: 'Bulleted list', glyph: <Icon name="bullets" size={14} /> },
  { kind: 'number', label: 'Numbered list', glyph: <Icon name="numbers" size={14} /> },
  { kind: 'quote', label: 'Quote', glyph: <Icon name="quote" size={14} /> },
  { kind: 'code', label: 'Code', glyph: <Icon name="code" size={14} /> },
];
const ASK_ICONS: Record<string, IconName> = {
  improve: 'edit',
  tasks: 'tasks',
  shorter: 'filter',
  explain: 'question',
};

/**
 * The bar over selected text, after Notion's: ask an agent, turn the block into another kind,
 * link, and the inline styles. One quiet row; its menus open below it.
 */
export function SelectionBar({
  selection,
  trusted,
  onMark,
  onLink,
  onTurnInto,
  onAsk,
}: {
  selection: SelectionState;
  trusted: boolean;
  onMark: (kind: MarkKind) => void;
  onLink: (href: string) => void;
  onTurnInto: (kind: BlockKind) => void;
  onAsk: (prompt: string) => void;
}) {
  const [open, setOpen] = useState<'ask' | 'turn' | 'link'>();
  const [href, setHref] = useState('');
  const [question, setQuestion] = useState('');
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useLayoutEffect(() => {
    if (bar.current) setWidth(bar.current.offsetWidth);
  }, []);
  const left = Math.max(8, Math.min(selection.left - width / 2, window.innerWidth - width - 8));
  const above = selection.top > 96;
  const current = BLOCKS.find((block) => block.kind === selection.block) ?? BLOCKS[0];
  const marks: { kind: MarkKind; icon: IconName; label: string }[] = [
    { kind: 'bold', icon: 'bold', label: 'Bold · ⌘B' },
    { kind: 'italic', icon: 'italic', label: 'Italic · ⌘I' },
    { kind: 'strike', icon: 'strike', label: 'Strikethrough' },
    { kind: 'code', icon: 'code', label: 'Inline code · ⌘E' },
  ];
  const toggle = (menu: 'ask' | 'turn' | 'link') => {
    setOpen((value) => (value === menu ? undefined : menu));
    if (menu === 'link') setHref(selection.href ?? '');
  };
  const item =
    'flex w-full items-center justify-start gap-2.5 rounded-md px-2 py-[5px] text-left text-[13px] text-foreground hover:bg-muted';
  const tool =
    'grid h-7 min-w-7 place-items-center rounded-md px-1 text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground';
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Format"
      className="page-selection-bar fixed z-40 animate-menu-in motion-reduce:animate-none"
      style={above ? { left, top: selection.top - 42 } : { left, top: selection.bottom + 8 }}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <div className="flex h-9 items-center gap-px rounded-lg border border-subtle bg-overlay px-1 shadow-md">
        {trusted ? (
          <>
            <button
              type="button"
              aria-expanded={open === 'ask'}
              onClick={() => toggle('ask')}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-link hover:bg-muted aria-expanded:bg-muted"
            >
              <Icon name="logo" size={13} />
              Ask agent
            </button>
            <span className="mx-1 h-5 w-px bg-subtle" />
          </>
        ) : null}
        <button
          type="button"
          aria-label={`Turn into · now ${current.label}`}
          aria-expanded={open === 'turn'}
          onClick={() => toggle('turn')}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-foreground hover:bg-muted aria-expanded:bg-muted"
        >
          {current.label}
          <span className="text-faint">
            <Icon name="chevronDown" size={11} />
          </span>
        </button>
        <span className="mx-1 h-5 w-px bg-subtle" />
        <Hint label={selection.href ? 'Edit link' : 'Link'}>
          <button
            type="button"
            aria-label="Link"
            aria-pressed={Boolean(selection.href)}
            aria-expanded={open === 'link'}
            onClick={() => toggle('link')}
            className={tool}
          >
            <Icon name="link" size={14} />
          </button>
        </Hint>
        <span className="mx-1 h-5 w-px bg-subtle" />
        {marks.map((mark) => (
          <Hint key={mark.kind} label={mark.label}>
            <button
              type="button"
              aria-label={mark.label.split(' · ')[0]}
              aria-pressed={selection.active[mark.kind]}
              onClick={() => onMark(mark.kind)}
              className={tool}
            >
              <Icon name={mark.icon} size={14} />
            </button>
          </Hint>
        ))}
      </div>
      {open === 'ask' ? (
        <div className="mt-1.5 w-[340px] rounded-xl border border-subtle bg-overlay p-1.5 shadow-md">
          <form
            className="page-ask-box flex items-center gap-1 rounded-lg border border-subtle bg-canvas py-1 pr-1 pl-2.5 focus-within:border-strong"
            onSubmit={(event) => {
              event.preventDefault();
              if (!question.trim()) return;
              setOpen(undefined);
              onAsk(question);
              setQuestion('');
            }}
          >
            <input
              // biome-ignore lint/a11y/noAutofocus: you just opened Ask agent to type
              autoFocus
              value={question}
              placeholder="Ask an agent about this…"
              aria-label="Ask an agent about the selection"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(undefined);
              }}
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint focus-visible:outline-none"
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={!question.trim()}
              className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-canvas disabled:opacity-30"
            >
              <Icon name="arrow" size={12} />
            </button>
          </form>
          <div className="px-2 pt-2 pb-1 text-[11px] text-faint">Or ask it to</div>
          {ASK_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => {
                setOpen(undefined);
                onAsk(preset.prompt);
              }}
              className={item}
            >
              <span className="text-muted-foreground">
                <Icon name={ASK_ICONS[preset.key] ?? 'edit'} size={14} />
              </span>
              {preset.label}
            </button>
          ))}
        </div>
      ) : open === 'turn' ? (
        <div
          className="mt-1.5 w-[220px] rounded-lg border border-subtle bg-overlay p-1 shadow-md"
          style={{ marginLeft: trusted ? 96 : 0 }}
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] text-faint">Turn into</div>
          {BLOCKS.map((block) => (
            <button
              key={block.kind}
              type="button"
              onClick={() => {
                setOpen(undefined);
                onTurnInto(block.kind);
              }}
              className={item}
            >
              <span className="grid size-5 place-items-center rounded border border-subtle text-muted-foreground">
                {block.glyph}
              </span>
              <span className="flex-1">{block.label}</span>
              {block.kind === selection.block ? (
                <span className="text-muted-foreground">
                  <Icon name="check" size={13} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : open === 'link' ? (
        <div className="mt-1.5 flex w-[320px] items-center gap-1 rounded-lg border border-subtle bg-overlay p-1 shadow-md">
          <input
            // biome-ignore lint/a11y/noAutofocus: you just asked to add a link
            autoFocus
            value={href}
            placeholder="Paste a link or a workspace path"
            aria-label="Link address"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onLink(href.trim());
                setOpen(undefined);
              }
              if (event.key === 'Escape') setOpen(undefined);
            }}
            className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[13px] placeholder:text-faint"
          />
          {selection.href ? (
            <SmallButton
              onClick={() => {
                onLink('');
                setOpen(undefined);
              }}
            >
              Remove
            </SmallButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
