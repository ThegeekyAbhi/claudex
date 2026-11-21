/**
 * Daily pages: one per day, under `daily/`.
 */

export function dailyId(day: string): string {
  return `daily/${day}`;
}
export function dailyDay(id: string): string | undefined {
  return /^daily\/(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1];
}
/** `Friday, 21 November` — written into the page, so it stays the same in every locale. */
export function dayTitle(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, date));
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    value.getUTCDay()
  ];
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${weekday}, ${date} ${months[month - 1]}`;
}
export function dailyTemplate(day: string): string {
  return `---\nicon: 📅\n---\n\n# ${dayTitle(day)}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n`;
}
