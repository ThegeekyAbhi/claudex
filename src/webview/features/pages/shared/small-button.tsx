import type { ReactNode } from 'react';

export function SmallButton({
  children,
  onClick,
  strong,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  strong?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-[3px] text-[12px] disabled:opacity-50 ${
        strong
          ? 'bg-accent text-accent-foreground enabled:hover:bg-accent-hover'
          : 'text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
