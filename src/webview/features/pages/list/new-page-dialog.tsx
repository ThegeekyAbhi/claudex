import { type ReactElement, useState } from 'react';
import type { PAGE_ICONS } from '../../../../shared/domain/pages/meta';
import {
  PAGE_STARTER_LABELS,
  PAGE_STARTERS,
  type PageStarter,
} from '../../../../shared/domain/pages/starters';
import { PAGE_TITLE_LIMIT } from '../../../../shared/domain/pages/title';
import { Icon } from '../../../components/icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { IconGrid } from '../page/header/icon-picker';
import { post } from '../shared/page-bridge';

type PageIcon = (typeof PAGE_ICONS)[number];

const STARTER_ICONS: Record<PageStarter, Parameters<typeof Icon>[0]['name']> = {
  blank: 'page',
  notes: 'edit',
  checklist: 'tasks',
  plan: 'plan',
};
const STARTER_HINTS: Record<PageStarter, string> = {
  blank: 'An empty page',
  notes: 'A notes section',
  checklist: 'A list of tasks',
  plan: 'Goal, steps, questions',
};

/**
 * Names a page before it exists, so its tab is named from the start: a title, an optional icon,
 * and what the page starts with. Enter creates it; Escape or Cancel leaves everything as it was.
 */
export function NewPageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState<PageIcon>();
  const [starter, setStarter] = useState<PageStarter>('blank');
  const [picking, setPicking] = useState(false);
  const name = title.replace(/\s+/g, ' ').trim();
  const reset = () => {
    setTitle('');
    setIcon(undefined);
    setStarter('blank');
    setPicking(false);
  };
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };
  const create = () => {
    if (!name) return;
    post({
      type: 'pageNew',
      title: name,
      ...(icon ? { icon } : {}),
      ...(starter === 'blank' ? {} : { starter }),
    });
    close(false);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="w-[min(480px,calc(100vw-24px))] max-w-none gap-0 rounded-xl border-strong bg-overlay p-0 text-foreground shadow-[var(--shadow)]"
        showCloseButton={false}
      >
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <div className="flex items-center justify-between px-5 pt-4">
            <DialogTitle className="text-[13px] font-semibold text-foreground">
              New page
            </DialogTitle>
            <button
              type="button"
              aria-label="Close"
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => close(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <DialogDescription className="sr-only">
            Name the page, then choose an icon and what it starts with. You can rename it later by
            editing its heading.
          </DialogDescription>

          <div className="flex items-center gap-2 px-5 pt-3 pb-4">
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={icon ? `Icon ${icon}, change` : 'Add an icon'}
                  className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-strong text-[24px] text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
                >
                  {icon ?? <Icon name="plus" size={16} />}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[232px] p-2" aria-label="Choose an icon">
                <IconGrid
                  onPick={(choice) => {
                    setIcon(choice);
                    setPicking(false);
                  }}
                />
                {icon ? (
                  <button
                    type="button"
                    className="mt-1.5 w-full justify-start rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setIcon(undefined);
                      setPicking(false);
                    }}
                  >
                    Remove icon
                  </button>
                ) : null}
              </PopoverContent>
            </Popover>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Page name</span>
              <input
                autoFocus
                value={title}
                maxLength={PAGE_TITLE_LIMIT}
                placeholder="Untitled page"
                onChange={(event) => setTitle(event.target.value)}
                className="w-full bg-transparent text-[22px] font-semibold tracking-tight text-foreground placeholder:text-faint focus-visible:outline-none"
              />
            </label>
          </div>

          <div className="border-t border-subtle px-5 pt-3 pb-4">
            {/* Native radios: arrow keys move between them, and Enter still creates the page. */}
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="p-0 text-[11.5px] font-medium text-muted-foreground">
                Start with
              </legend>
              <div className="mt-2 grid grid-cols-4 gap-2 max-[420px]:grid-cols-2">
                {PAGE_STARTERS.map((choice) => (
                  <label
                    key={choice}
                    className="flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-subtle px-2.5 py-2 text-muted-foreground hover:bg-muted hover:text-foreground has-[:checked]:border-[var(--focus)] has-[:checked]:bg-muted has-[:checked]:text-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-[var(--focus)]"
                  >
                    <input
                      type="radio"
                      name="new-page-starter"
                      value={choice}
                      checked={starter === choice}
                      onChange={() => setStarter(choice)}
                      className="sr-only"
                    />
                    <Icon name={STARTER_ICONS[choice]} size={15} />
                    <span className="text-[12.5px]">{PAGE_STARTER_LABELS[choice]}</span>
                    <span className="sr-only">: {STARTER_HINTS[choice]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-subtle px-5 py-3">
            <span className="text-[11.5px] text-faint">
              Rename it later by editing its heading.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-8 rounded-md px-3 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => close(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name}
                className="h-8 gap-2 rounded-md bg-primary px-3 text-[12.5px] text-primary-foreground enabled:hover:bg-accent-hover"
              >
                Create
                <kbd className="text-[10.5px] text-current opacity-70">⏎</kbd>
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
