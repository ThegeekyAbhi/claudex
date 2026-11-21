/** Links open with ⌘ or Ctrl held, so a plain click still places the cursor. */
export function openLink(event: MouseEvent, open: (href: string) => void): boolean {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
  if (!anchor || !(event.metaKey || event.ctrlKey)) return false;
  event.preventDefault();
  open(anchor.getAttribute('href') ?? '');
  return true;
}
