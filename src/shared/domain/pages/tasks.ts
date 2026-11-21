import { splitFrontMatter } from './meta';

/**
 * Checklists on a page: reading them, and moving unfinished ones to another page.
 */

const TASK = /^(\s*)(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s?(.*)$/;
export interface PageTask {
  line: number;
  text: string;
  done: boolean;
  /** Indentation, for nested tasks. */
  depth: number;
}
/** Every checklist item on the page, outside code blocks. */
export function pageTasks(body: string): PageTask[] {
  const tasks: PageTask[] = [];
  let fence = false;
  body.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const match = TASK.exec(line);
    if (match)
      tasks.push({
        line: index,
        text: match[3].trim(),
        done: match[2] !== ' ',
        depth: match[1].replace(/\t/g, '  ').length,
      });
  });
  return tasks;
}

/**
 * Unfinished tasks of an earlier page, with the lines that belong to each (its nested items),
 * ready to move to today. Done children stay behind with nothing else.
 */
export function openTaskBlocks(body: string): { lines: number[]; markdown: string }[] {
  const all = body.split('\n');
  const blocks: { lines: number[]; markdown: string }[] = [];
  const tasks = pageTasks(body);
  const claimed = new Set<number>();
  for (const task of tasks) {
    if (task.done || claimed.has(task.line)) continue;
    const lines = [task.line];
    for (let next = task.line + 1; next < all.length; next++) {
      const line = all[next];
      if (!line.trim()) break;
      const indent = /^(\s*)/.exec(line)?.[1].replace(/\t/g, '  ').length ?? 0;
      if (indent <= task.depth) break;
      lines.push(next);
    }
    for (const line of lines) claimed.add(line);
    blocks.push({
      lines,
      markdown: lines.map((line) => all[line].slice(task.depth)).join('\n'),
    });
  }
  return blocks;
}

/**
 * Moves the unfinished tasks of `from` under the first heading of `to` that names tasks (or to
 * the end). Returns both new texts, or undefined when there is nothing to move.
 */
export function carryOpenTasks(
  from: string,
  to: string,
): { from: string; to: string; count: number } | undefined {
  const source = splitFrontMatter(from);
  const blocks = openTaskBlocks(source.body);
  if (!blocks.length) return undefined;
  const drop = new Set(blocks.flatMap((block) => block.lines));
  const rest = source.body
    .split('\n')
    .filter((_, index) => !drop.has(index))
    .join('\n');
  const moved = blocks.map((block) => block.markdown).join('\n');
  return { from: source.front + rest, to: appendTasks(to, moved), count: blocks.length };
}

/**
 * The page with tasks added at the end of its tasks section (a heading such as "Tasks" or
 * "Today"), replacing a lone empty task, or at the end of the page when it has none.
 */
export function appendTasks(page: string, tasks: string): string {
  const { front, body } = splitFrontMatter(page);
  const lines = body.split('\n');
  const heading = lines.findIndex((line) => /^#{2,6}\s+(tasks|todo|to-do|today)\b/i.test(line));
  if (heading < 0) return `${front}${body.replace(/\s*$/, '')}\n\n${tasks}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
  const section = lines
    .slice(heading + 1, end)
    .filter((line) => !/^\s*[-*+]\s+\[ \]\s*$/.test(line));
  while (section.length && !section[0].trim()) section.shift();
  while (section.length && !section[section.length - 1].trim()) section.pop();
  const after = lines.slice(end);
  return (
    front +
    [...lines.slice(0, heading + 1), '', ...section, ...tasks.split('\n'), '', ...after].join('\n')
  );
}
