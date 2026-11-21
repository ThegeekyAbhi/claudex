import type { ReactNode } from 'react';

/** A small popover at a point on the screen, flipping above it near the bottom. */
export function Floating({
  left,
  top,
  label,
  children,
}: {
  left: number;
  top: number;
  label: string;
  children: ReactNode;
}) {
  const width = 260;
  const x = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  const flip = top > window.innerHeight - 320;
  return (
    <div
      role="listbox"
      aria-label={label}
      className="fixed z-40 rounded-lg border border-strong bg-overlay shadow-md animate-menu-in motion-reduce:animate-none"
      style={flip ? { left: x, bottom: window.innerHeight - top + 30 } : { left: x, top }}
    >
      {children}
    </div>
  );
}
