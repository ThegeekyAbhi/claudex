import { dailyDay } from './daily';
import { splitFrontMatter } from './meta';
import { pageTasks } from './tasks';
import { pageTitle } from './title';

/**
 * Pages: your Markdown notes for this workspace. Each page is an ordinary `.md` file. Its
 * name is its first `# heading`, and a small front matter block may hold its icon.
 *
 * Everything under `domain/pages` is pure, so the host, the page editor and the tests share one
 * meaning. This module is what the Pages list and agents see of a page.
 */

/** `daily/2026-11-21` for a day's page, or `release-plan-3f9a1c` for any other. */
export const PAGE_ID = /^(?:daily\/\d{4}-\d{2}-\d{2}|[a-z0-9][a-z0-9-]{0,79})$/;
export const PAGE_TEXT_LIMIT = 500_000;

/** What the Pages list shows for one page. */
export interface PageEntry {
  id: string;
  title: string;
  icon?: string;
  pinned?: boolean;
  by?: 'agent';
  /** The day, for a daily page. */
  day?: string;
  updatedAt: number;
  openTasks: number;
  doneTasks: number;
}

export function pageEntry(id: string, text: string, updatedAt: number): PageEntry {
  const { body, meta } = splitFrontMatter(text);
  const tasks = pageTasks(body);
  const doneTasks = tasks.filter((task) => task.done).length;
  const day = dailyDay(id);
  return {
    id,
    title: pageTitle(body),
    ...(meta.icon ? { icon: meta.icon } : {}),
    ...(meta.pinned ? { pinned: true } : {}),
    ...(meta.by ? { by: meta.by } : {}),
    ...(day ? { day } : {}),
    updatedAt,
    openTasks: tasks.length - doneTasks,
    doneTasks,
  };
}

/** A page as an agent reads it: plain Markdown, with its id to refer to it. */
export function pageForAgent(entry: PageEntry, text: string): string {
  return `Page “${entry.title}” (id: ${entry.id})\n\n${splitFrontMatter(text).body.trim() || '(empty)'}`;
}
