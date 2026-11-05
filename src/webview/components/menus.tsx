import type { ReactElement, ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from './icons';

/** A quick label for an icon button. No motion: these appear many times a day. */
export function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        className="border border-strong z-40 rounded-md px-[7px] py-0.5 text-[11.5px] shadow-md bg-popover text-popover-foreground [&>svg]:hidden"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
      >
        {label}
      </TooltipContent>
    </Tooltip>
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
/** A small dropdown for short choices such as mode and location. */
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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={`chip gap-[5px] min-h-6 px-1.5 py-[3px] text-[11.5px] text-muted-foreground whitespace-nowrap enabled:hover:text-foreground enabled:hover:bg-muted aria-expanded:text-foreground aria-expanded:bg-muted max-[480px]:in-[.composer-controls]:not-[.mode-chip]:min-w-0 max-[480px]:in-[.composer-controls]:not-[.mode-chip]:shrink ${className}`}
          aria-label={ariaLabel}
        >
          {icon}
          <span className="text-foreground max-[480px]:min-w-0 max-[480px]:overflow-hidden max-[480px]:text-ellipsis">
            {label}
          </span>
          <Icon name="chevronDown" size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="bg-overlay text-foreground border border-strong z-40 rounded-lg shadow-md animate-menu-in [transform-origin:var(--radix-popover-content-transform-origin,var(--radix-dropdown-menu-content-transform-origin))] focus:outline-none focus-visible:outline-none motion-reduce:animate-none max-w-[300px] min-w-[200px] p-1"
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
          <DropdownMenuLabel className="pt-[5px] px-[7px] pb-[3px] text-[11px] text-faint">
            {heading}
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuRadioGroup value={items.find((item) => item.selected)?.key ?? ''}>
          {items.map((item) => (
            <DropdownMenuRadioItem
              key={item.key}
              value={item.key}
              className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-[7px] rounded-[5px] cursor-pointer text-left select-none outline-none data-[selected=true]:bg-muted data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint py-1 pr-7 pl-2 text-xs [&>span:first-child]:right-2 [&>span:first-child]:left-auto"
              onSelect={item.onSelect}
            >
              {item.icon}
              <span className="flex-1 min-w-0 flex flex-col text-[12px] [&_small]:text-[11px] [&_small]:text-muted-foreground [&_small]:truncate">
                <span>{item.label}</span>
                {item.description ? <small>{item.description}</small> : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
          aria-label="More actions"
        >
          <Icon name="more" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="bg-overlay text-foreground border border-strong z-40 rounded-lg shadow-md animate-menu-in [transform-origin:var(--radix-popover-content-transform-origin,var(--radix-dropdown-menu-content-transform-origin))] focus:outline-none focus-visible:outline-none motion-reduce:animate-none max-w-[300px] min-w-[200px] p-1"
        side="bottom"
        align="end"
        sideOffset={4}
        collisionPadding={8}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            className="menu-item flex items-center justify-start gap-2 w-full min-h-[26px] px-[7px] rounded-[5px] cursor-pointer text-left select-none outline-none data-[selected=true]:bg-muted data-highlighted:bg-muted data-[active=true]:bg-muted [&.category>svg:last-child]:text-faint py-1 pl-2 text-xs"
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {item.icon}
            <span className="flex-1 min-w-0 flex flex-col text-[12px] [&_small]:text-[11px] [&_small]:text-muted-foreground [&_small]:truncate">
              {item.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
