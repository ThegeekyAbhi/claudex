import { makeDiff, patchFromContent, patchFromEdit } from '../diff';
import type { FileDiff, ToolInfo, ToolKind } from '../model';

/** Removes the shell wrapper Codex reports, so `/bin/zsh -lc 'pnpm test'` reads as `pnpm test`. */
export function displayCommand(command: string): string {
  const match = /^\S*\/?(?:zsh|bash|sh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(command.trim());
  return match ? match[2] : command.trim();
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function shortPath(value: string, cwd?: string): string {
  return cwd && value.startsWith(`${cwd}/`) ? value.slice(cwd.length + 1) : value;
}
export function claudeToolDiffs(
  name: string,
  input: Record<string, unknown>,
  cwd?: string,
): FileDiff[] | undefined {
  const file = shortPath(text(input.file_path), cwd);
  if (!file) return undefined;
  if (name === 'Edit')
    return [
      makeDiff(file, 'update', patchFromEdit(text(input.old_string), text(input.new_string))),
    ];
  // Until the tool runs this could be a new file or an overwrite, so it is not labelled as new.
  if (name === 'Write')
    return [makeDiff(file, 'update', patchFromContent(text(input.content), '+'))];
  if (name === 'MultiEdit' && Array.isArray(input.edits))
    return [
      makeDiff(
        file,
        'update',
        input.edits
          .map((edit: any) => patchFromEdit(text(edit?.old_string), text(edit?.new_string)))
          .join('\n'),
      ),
    ];
  return undefined;
}
export function describeClaudeTool(
  name: string,
  input: Record<string, unknown>,
  cwd?: string,
): Pick<ToolInfo, 'kind' | 'name' | 'title' | 'input' | 'diffs'> {
  const raw = JSON.stringify(input, null, 2);
  const file = shortPath(text(input.file_path) || text(input.notebook_path), cwd);
  const make = (kind: ToolKind, title: string, withInput = true) => ({
    kind,
    name,
    title: title || name,
    ...(withInput ? { input: raw } : {}),
  });
  switch (name) {
    case 'Bash':
      return make('command', text(input.command), false);
    case 'Read':
      return make('read', file, false);
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return { ...make('edit', file, false), diffs: claudeToolDiffs(name, input, cwd) };
    case 'NotebookEdit':
      return make('edit', file);
    case 'Grep':
    case 'Glob':
      return make('search', text(input.pattern), false);
    case 'WebSearch':
      return make('web', text(input.query), false);
    case 'WebFetch':
      return make('web', text(input.url), false);
    case 'Task':
    case 'Agent':
      return make('agent', text(input.description) || text(input.subagent_type));
    case 'ExitPlanMode':
      return make('other', 'Presented a plan', false);
    case 'EnterPlanMode':
      return make('other', 'Started planning', false);
    case 'TodoWrite':
      return make('other', 'Updated the task list');
    default:
      return make('other', name.replace(/^mcp__(.+?)__/, '$1 · '));
  }
}
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((block: any) =>
        typeof block?.text === 'string' ? block.text : block?.type ? `[${block.type}]` : '',
      )
      .filter(Boolean)
      .join('\n');
  return content === undefined || content === null ? '' : JSON.stringify(content);
}
