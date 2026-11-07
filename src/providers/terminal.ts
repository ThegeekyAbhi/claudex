import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { effectiveEffort } from '../shared/domain/thinking';
import type { Session } from '../shared/model';
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
process.stdout.write(JSON.stringify(records.map(({ type, uuid, isMeta, timestamp, parent_tool_use_id, message }) =>
  ({ type, uuid, isMeta, timestamp, parent_tool_use_id,
     message: { id: message?.id, model: message?.model, content: message?.content } }))));
`;
const LIST_SCRIPT = `
const [sdk, dir, limit] = process.argv.slice(1);
const { listSessions } = await import(sdk);
// The same sessions the terminal's own /resume offers: no headless SDK runs.
const sessions = await listSessions({ dir, limit: Number(limit), includeWorktrees: false, includeProgrammatic: false });
process.stdout.write(JSON.stringify(sessions.map(({ sessionId, summary, customTitle, firstPrompt, lastModified, createdAt, cwd }) =>
  ({ sessionId, summary, customTitle, firstPrompt, lastModified, createdAt, cwd }))));
`;
/**
 * Claude's history is found through CLAUDE_CONFIG_DIR, which belongs to the whole process, so each
 * read gets a short process of its own. That keeps a second account from affecting anything else.
 */
function runClaudeScript(
  script: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  executable: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--input-type=module', '-e', script, ...args], {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
      stdio: 'pipe',
    });
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
        const parsed = JSON.parse(Buffer.concat(out).toString('utf8'));
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch (error) {
        reject(error as Error);
      }
    });
  });
}
export async function readClaudeRecords(
  sdkPath: string,
  id: string,
  cwd: string,
  env: Record<string, string> = {},
  executable: string = process.execPath,
): Promise<unknown[]> {
  const records = await runClaudeScript(
    READ_SCRIPT,
    [pathToFileURL(sdkPath).href, id, cwd],
    cwd,
    env,
    executable,
  );
  // This thread has messages, so finding none means the wrong place was read.
  if (!records.length) throw new Error('Claude Code found no history for this thread.');
  return records;
}
/** A session the CLI keeps for this folder, whether it ran here or in a terminal. */
export interface NativeSessionInfo {
  sessionId: string;
  title: string;
  /** Milliseconds since the epoch. */
  updatedAt: number;
  createdAt?: number;
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export async function listClaudeSessions(
  sdkPath: string,
  cwd: string,
  limit: number,
  env: Record<string, string> = {},
  executable: string = process.execPath,
): Promise<NativeSessionInfo[]> {
  const sessions = await runClaudeScript(
    LIST_SCRIPT,
    [pathToFileURL(sdkPath).href, cwd, String(limit)],
    cwd,
    env,
    executable,
  );
  return (sessions as any[]).flatMap((item) => {
    const updatedAt = Number(item?.lastModified);
    if (typeof item?.sessionId !== 'string' || !Number.isFinite(updatedAt)) return [];
    const title =
      text(item.customTitle) ?? text(item.summary) ?? text(item.firstPrompt) ?? 'Untitled';
    return [
      {
        sessionId: item.sessionId,
        title,
        updatedAt,
        ...(Number.isFinite(Number(item.createdAt)) ? { createdAt: Number(item.createdAt) } : {}),
      },
    ];
  });
}
const MAX_PAGES = 20;
/** Newest pages first, stopping once a page starts before `since`. Returns oldest first. */
export async function readCodexTurns(
  executable: string,
  threadId: string,
  cwd: string,
  since: number,
  env?: Record<string, string>,
): Promise<unknown[]> {
  const rpc = new JsonRpc(
    executable,
    ['app-server', '--listen', 'stdio://'],
    cwd,
    () => {},
    () => {},
    env,
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

async function codexRpc<T>(
  executable: string,
  cwd: string,
  env: Record<string, string> | undefined,
  use: (rpc: JsonRpc) => Promise<T>,
): Promise<T> {
  const rpc = new JsonRpc(
    executable,
    ['app-server', '--listen', 'stdio://'],
    cwd,
    () => {},
    () => {},
    env,
  );
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.6.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.write({ method: 'initialized' });
    return await use(rpc);
  } finally {
    rpc.dispose();
  }
}
/** Threads Codex keeps for this folder, started by you: not its own workers or reviews. */
export function listCodexThreads(
  executable: string,
  cwd: string,
  limit: number,
  env?: Record<string, string>,
): Promise<NativeSessionInfo[]> {
  return codexRpc(executable, cwd, env, async (rpc) => {
    const result: any = await rpc.request('thread/list', {
      cwd,
      limit,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer'],
    });
    return ((result?.data ?? []) as any[]).flatMap((thread) => {
      if (typeof thread?.id !== 'string' || typeof thread.updatedAt !== 'number') return [];
      return [
        {
          sessionId: thread.id,
          title: text(thread.name) ?? text(thread.preview)?.split('\n')[0] ?? 'Untitled',
          updatedAt: thread.updatedAt * 1000,
          ...(typeof thread.createdAt === 'number' ? { createdAt: thread.createdAt * 1000 } : {}),
        },
      ];
    });
  });
}
