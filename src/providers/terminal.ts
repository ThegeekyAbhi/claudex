import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { Session } from '../core/model';
import { effectiveEffort } from '../core/thinking';
import { JsonRpc } from './process';

/**
 * How to continue a thread in the CLI itself, in the same mode and on the same model.
 * Every flag is one the rich chat already uses for this mode. Nothing here bypasses permissions.
 */
export function terminalArgs(
  session: Pick<
    Session,
    'provider' | 'nativeId' | 'mode' | 'model' | 'effort' | 'thinking' | 'nativeSettings'
  >,
): { args: string[]; note?: string } {
  const id = session.nativeId ?? '';
  const effort = effectiveEffort(session);
  if (session.provider === 'claude') {
    const args = ['--resume', id];
    if (session.model) args.push('--model', session.model);
    if (session.effort) args.push('--effort', session.effort);
    if (session.mode === 'auto') args.push('--permission-mode', 'auto');
    if (session.mode === 'plan') args.push('--permission-mode', 'plan');
    // Last, because this flag takes every word up to the next flag.
    if (session.mode === 'ask')
      args.push(
        '--permission-mode',
        'dontAsk',
        '--disallowedTools',
        'Edit',
        'Write',
        'NotebookEdit',
      );
    return { args };
  }
  const args = ['resume'];
  if (session.model) args.push('-m', session.model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  if (session.mode === 'ask') args.push('-s', 'read-only', '-a', 'never');
  // The same rule as a rich chat turn: Auto review only sees what an on-request policy surfaces.
  if (session.mode === 'auto' && session.nativeSettings?.approvalPolicy === 'on-request')
    args.push('-c', 'approvals_reviewer="auto_review"');
  args.push(id);
  return session.mode === 'plan'
    ? {
        args,
        note: 'Codex has no flag to resume in Plan mode, so it opened with your Codex settings.',
      }
    : { args };
}
export interface TerminalHistory {
  messages: { role: 'user' | 'assistant'; text: string }[];
  tools: number;
}
function add(history: TerminalHistory, role: 'user' | 'assistant', text: string): void {
  const last = history.messages.at(-1);
  // The CLI records each block of one reply on its own.
  if (role === 'assistant' && last?.role === 'assistant') last.text += `\n\n${text}`;
  else history.messages.push({ role, text });
}
/** What the CLI recorded at or after `since`. Unknown timing is an error, never a guess. */
export function claudeHistorySince(records: unknown[], since: number): TerminalHistory {
  const history: TerminalHistory = { messages: [], tools: 0 };
  for (const raw of records as any[]) {
    if (raw.parent_tool_use_id || (raw.type !== 'user' && raw.type !== 'assistant')) continue;
    const at = Date.parse(raw.timestamp);
    if (Number.isNaN(at)) throw new Error('Claude Code did not say when a message was sent.');
    if (at < since) continue;
    const content = raw.message?.content;
    const blocks: any[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);
    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text as string)
      .join('\n\n')
      .trim();
    history.tools += blocks.filter((block) => block.type === 'tool_use').length;
    // Slash commands are recorded as markup, and aren't something you wrote.
    if (text && !/^<(?:local-)?command-/.test(text)) add(history, raw.type, text);
  }
  return history;
}
/** Turns as `thread/turns/list` returns them with `itemsView: 'full'`, oldest first. */
export function codexHistorySince(turns: unknown[], since: number): TerminalHistory {
  const history: TerminalHistory = { messages: [], tools: 0 };
  for (const turn of turns as any[])
    for (const item of turn.items ?? []) {
      const at = item.startedAtMs ?? (turn.startedAt ? turn.startedAt * 1000 : undefined);
      if (typeof at !== 'number') throw new Error('Codex did not say when a message was sent.');
      if (at < since) continue;
      if (item.type === 'userMessage') {
        const text = (item.content ?? [])
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text as string)
          .join('\n')
          .trim();
        if (text) add(history, 'user', text);
      } else if (item.type === 'agentMessage') {
        if (item.text?.trim()) add(history, 'assistant', item.text.trim());
      } else if (item.type !== 'reasoning') history.tools += 1;
    }
  return history;
}
const READ_SCRIPT = `
const [sdk, id, dir] = process.argv.slice(1);
const { getSessionMessages } = await import(sdk);
const records = await getSessionMessages(id, { dir });
process.stdout.write(JSON.stringify(records.map(({ type, timestamp, parent_tool_use_id, message }) =>
  ({ type, timestamp, parent_tool_use_id, message: { content: message?.content } }))));
`;
/**
 * Claude's history is found through CLAUDE_CONFIG_DIR, which belongs to the whole process, so the
 * read gets a short process of its own. That keeps a second account from affecting anything else.
 */
export function readClaudeRecords(
  sdkPath: string,
  id: string,
  cwd: string,
  env: Record<string, string> = {},
  executable: string = process.execPath,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ['--input-type=module', '-e', READ_SCRIPT, pathToFileURL(sdkPath).href, id, cwd],
      { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env }, stdio: 'pipe' },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Reading the history timed out.'));
    }, 20_000);
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      err = (err + String(chunk)).slice(-400);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(err.trim() || `The read exited with ${code}.`));
        return;
      }
      try {
        const records = JSON.parse(Buffer.concat(out).toString('utf8')) as unknown[];
        // This thread has messages, so finding none means the wrong place was read.
        if (!records.length) reject(new Error('Claude Code found no history for this thread.'));
        else resolve(records);
      } catch (error) {
        reject(error as Error);
      }
    });
  });
}
const MAX_PAGES = 20;
/** Newest pages first, stopping once a page starts before `since`. Returns oldest first. */
export async function readCodexTurns(
  executable: string,
  threadId: string,
  cwd: string,
  since: number,
): Promise<unknown[]> {
  const rpc = new JsonRpc(
    executable,
    ['app-server', '--listen', 'stdio://'],
    cwd,
    () => {},
    () => {},
  );
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.6.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.write({ method: 'initialized' });
    const turns: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result: any = await rpc.request('thread/turns/list', {
        threadId,
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'full',
        cursor,
      });
      turns.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
      const oldest = result.data?.at(-1)?.startedAt;
      if (!cursor || (typeof oldest === 'number' && oldest * 1000 < since)) break;
    }
    return turns.reverse();
  } finally {
    rpc.dispose();
  }
}
