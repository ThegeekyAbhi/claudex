import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/icons';

/**
 * The plan's build controls, shared by the chat's plan dock and a plan page's bar so both read
 * and behave the same.
 */
export const RING =
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus,var(--accent))]';
export const QUIET = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground ${RING}`;
/** Tinted like the mode chip: Auto's colour inside data-mode="auto", plain otherwise. */
export const TINTED = `inline-flex h-7 items-center gap-1.5 text-[12px] font-medium ${RING} focus-visible:ring-inset bg-muted text-foreground enabled:hover:bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] in-data-[mode]:bg-mode-tint in-data-[mode]:text-mode in-data-[mode]:enabled:hover:bg-[color-mix(in_srgb,var(--mode)_24%,transparent)]`;
export const MENU_ITEM =
  'flex w-full cursor-pointer select-none items-start gap-2.5 rounded-[5px] px-2 py-1.5 text-left outline-none data-highlighted:bg-muted';

/** The build menu's surface. */
export const MENU_CONTENT =
  'z-40 w-75 max-w-[calc(100vw-16px)] rounded-lg border border-strong bg-overlay p-1 text-foreground shadow-md animate-menu-in [transform-origin:var(--radix-dropdown-menu-content-transform-origin)] focus:outline-none motion-reduce:animate-none';

/** One build choice: icon, name, and what it does. */
export function MenuRow({
  icon,
  label,
  hint,
  trail,
}: {
  icon: IconName;
  label: string;
  hint: string;
  trail?: ReactNode;
}) {
  return (
    <>
      <span className="mt-px flex shrink-0 text-muted-foreground">
        <Icon name={icon} size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[12px]">{label}</span>
        <small className="text-[11px] leading-[1.4] text-muted-foreground">{hint}</small>
      </span>
      {trail}
    </>
  );
}
