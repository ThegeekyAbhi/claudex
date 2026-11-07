import type React from 'react';

/**
 * Arrow keys, Home and End move between a tablist's tabs and choose the one reached, the way the
 * ARIA tabs pattern describes. Only the chosen tab is in the Tab order (`tabIndex={selected ? 0 : -1}`).
 */
export function moveTabFocus(
  event: React.KeyboardEvent<HTMLElement>,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): void {
  const [back, forward] =
    orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (![back, forward, 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'),
  );
  const index = tabs.indexOf(document.activeElement as HTMLElement);
  if (index < 0 || !tabs.length) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? tabs[0]
      : event.key === 'End'
        ? tabs[tabs.length - 1]
        : tabs[(index + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length];
  next?.focus();
  next?.click();
}
