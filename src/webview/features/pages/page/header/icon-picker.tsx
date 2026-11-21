import { useState } from 'react';
import { PAGE_ICONS } from '../../../../../shared/model';
import { Icon } from '../../../../components/icons';
import { post } from '../../shared/page-bridge';

/** Every page icon to choose from; the page header and the New page dialog share it. */
export function IconGrid({ onPick }: { onPick: (icon: (typeof PAGE_ICONS)[number]) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {PAGE_ICONS.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-label={`Use ${choice}`}
          className="grid size-7 place-items-center rounded-md text-[17px] hover:bg-muted"
          onClick={() => onPick(choice)}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
export function IconPicker({ icon, editable }: { icon?: string; editable: boolean }) {
  const [open, setOpen] = useState(false);
  if (!editable) return null;
  return (
    <div className="group/icon relative mb-2 h-[60px]">
      {icon ? (
        <button
          type="button"
          aria-label="Change icon"
          className="rounded-lg px-1 text-[46px] leading-[60px] hover:bg-muted"
          onClick={() => setOpen((value) => !value)}
        >
          {icon}
        </button>
      ) : (
        <button
          type="button"
          className="mt-8 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-faint opacity-0 transition-opacity group-hover/icon:opacity-100 focus-visible:opacity-100 hover:bg-muted hover:text-muted-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="plus" size={12} />
          Add icon
        </button>
      )}
      {open ? (
        <div
          role="dialog"
          aria-label="Choose an icon"
          className="absolute top-full left-0 z-30 mt-1 w-[232px] rounded-lg border border-strong bg-overlay p-2 shadow-md"
        >
          <IconGrid
            onPick={(choice) => {
              post({ type: 'pageIcon', icon: choice });
              setOpen(false);
            }}
          />
          {icon ? (
            <button
              type="button"
              className="mt-1.5 w-full rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-muted"
              onClick={() => {
                post({ type: 'pageIcon' });
                setOpen(false);
              }}
            >
              Remove icon
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
