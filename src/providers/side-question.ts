import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Session } from '../shared/model';
import { initializeCodex } from './codex/handshake';
import { JsonRpc, type RpcMessage } from './process';
import type { Launcher } from './registry';
import { mergeEnv } from './spawn';
import { displayCommand } from './tool-format';

/**
 * A side question: answered from the thread's conversation so far, and never saved to the
 * thread or to the CLI's history. Each CLI does it with its own throwaway branch. Claude answers
 * with no tools; Codex runs in a read-only sandbox, so it may look at files but change nothing.
 */
export interface SideQuestion {
  session: Pick<Session, 'provider' | 'cwd' | 'nativeId' | 'model' | 'forkFrom'>;
  launcher: Launcher;
  text: string;
  /** Recent side questions and their answers, so a follow-up reads in context. */
  earlier?: { question: string; answer: string }[];
  onText: (delta: string) => void;
  /** Something the agent looked at while answering, such as a command it ran. */
  onActivity?: (label: string) => void;
  signal: AbortSignal;
}

const INSTRUCTION: Record<SideQuestion['session']['provider'], string> = {
  claude:
    'This is a side question asked while the main task continues. Answer briefly from the conversation so far. Do not use tools, read files, or run commands; if you cannot answer without them, say so.',
  codex:
    'This is a side question asked while the main task continues. Answer briefly, mainly from the conversation so far. You may read files or run read-only commands if that is needed to answer; never change anything.',
};

/** What the side question's instructions allow, for tests and the UI. */
export function sideQuestionInstruction(provider: SideQuestion['session']['provider']): string {
  return INSTRUCTION[provider];
}

function prompt(question: SideQuestion): string {
  const earlier = (question.earlier ?? [])
    .slice(-5)
    .map((item) => `Side question: ${item.question}\nYour answer: ${item.answer}`)
    .join('\n\n');
  return [
    INSTRUCTION[question.session.provider],
    earlier && `Earlier side questions:\n\n${earlier}`,
    question.text,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Where the conversation lives in the CLI: the thread's session, or the one it will branch from. */
function source(session: SideQuestion['session']): { nativeId: string; at?: string } | undefined {
  if (session.nativeId) return { nativeId: session.nativeId };
  return session.forkFrom;
}

export async function askClaude(
  question: SideQuestion,
  query?: typeof import('@anthropic-ai/claude-agent-sdk').query,
): Promise<void> {
  const run = query ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
  const from = source(question.session);
  const abortController = new AbortController();
  question.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const stream = run({
    prompt: prompt(question),
    options: {
      cwd: question.session.cwd,
      pathToClaudeCodeExecutable: question.launcher.executable,
      ...(from
        ? {
            resume: from.nativeId,
            forkSession: true,
            ...(from.at ? { resumeSessionAt: from.at } : {}),
          }
        : {}),
      // Not written anywhere: the branch disappears when the answer ends.
      persistSession: false,
      tools: [],
      maxTurns: 1,
      // No hooks or MCP servers from settings; a side question touches nothing.
      settingSources: [],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,
      abortController,
      canUseTool: async () => ({
        behavior: 'deny',
        message: 'Side questions answer without tools.',
      }),
      ...(question.launcher.env ? { env: mergeEnv(question.launcher.env) } : {}),
      ...(question.session.model ? { model: question.session.model } : {}),
    },
  });
  let streamed = false;
  for await (const message of stream as AsyncIterable<SDKMessage>) {
    if (message.type === 'stream_event' && !message.parent_tool_use_id) {
      const event = message.event;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        streamed = true;
        question.onText(event.delta.text);
      }
    } else if (message.type === 'assistant' && !streamed && !message.parent_tool_use_id) {
      for (const block of message.message.content)
        if (block.type === 'text') question.onText(block.text);
    } else if (message.type === 'result') {
      if (message.is_error)
        throw new Error(
          'errors' in message && message.errors.length
            ? message.errors.join('\n')
            : 'Claude could not answer.',
        );
      return;
    }
  }
  if (question.signal.aborted) return;
  throw new Error('Claude stopped before answering.');
}

/** A short line for something Codex started while answering; undefined for its own text. */
export function codexActivity(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  if (item.type === 'commandExecution') {
    const actions: { type?: string; path?: string; query?: string }[] = Array.isArray(
      item.commandActions,
    )
      ? item.commandActions
      : [];
    const reads = actions.filter((entry) => entry.type === 'read' && entry.path);
    if (reads.length && reads.length === actions.length)
      return `Read ${reads.map((entry) => entry.path).join(', ')}`;
    if (actions.length && actions.every((entry) => entry.type === 'search'))
      return `Searched ${actions[0]?.query ?? 'files'}`;
    if (actions.length && actions.every((entry) => entry.type === 'listFiles'))
      return `Listed ${actions[0]?.path ?? 'files'}`;
    return `Ran ${displayCommand(String(item.command ?? ''))}`;
  }
  if (item.type === 'webSearch') return `Searched the web${item.query ? ` for ${item.query}` : ''}`;
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall')
    return `Used ${item.server ? `${item.server} · ` : ''}${item.tool ?? 'a tool'}`;
  if (item.type === 'imageView') return `Viewed ${item.path ?? 'an image'}`;
  if (item.type === 'fileChange') return 'Tried to change files (read-only, so nothing changed)';
  return undefined;
}

type CodexRpc = Pick<JsonRpc, 'request' | 'write' | 'reply' | 'dispose'>;

export async function askCodex(
  question: SideQuestion,
  connect: (
    onMessage: (message: RpcMessage) => void,
    onClose: (error: Error) => void,
  ) => CodexRpc = (onMessage, onClose) =>
    new JsonRpc(
      question.launcher.executable,
      ['app-server', '--listen', 'stdio://'],
      question.session.cwd,
      onMessage,
      onClose,
      question.launcher.env,
      { name: 'Codex' },
    ),
): Promise<void> {
  const from = source(question.session);
  let threadId: string | undefined;
  let turnId: string | undefined;
  let finish: (error?: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    finish = (error) => (error ? reject(error) : resolve());
  });
  const rpc: CodexRpc = connect(
    (message: RpcMessage) => {
      const { method, params: p } = message;
      if (!method) return;
      if (message.id !== undefined) {
        // Nothing runs or changes for a side question.
        if (method.endsWith('/requestApproval')) rpc.reply(message.id, { decision: 'decline' });
        else
          rpc.write({
            id: message.id,
            error: { code: -32601, message: 'Not available in a side question.' },
          });
        return;
      }
      if (!p || (threadId && p.threadId && p.threadId !== threadId)) return;
      if (method === 'item/agentMessage/delta' && typeof p.delta === 'string')
        question.onText(p.delta);
      if (method === 'item/started') {
        const label = codexActivity(p.item);
        if (label) question.onActivity?.(label);
      }
      if (method === 'turn/completed')
        finish(
          p.turn?.status === 'completed' || question.signal.aborted
            ? undefined
            : new Error(p.turn?.error?.message ?? 'Codex stopped before answering.'),
        );
      if (method === 'error' && p.error?.message && !p.willRetry)
        finish(new Error(p.error.message));
    },
    (error) => finish(error),
  );
  const stop = () => {
    if (threadId && turnId)
      void rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    finish();
  };
  question.signal.addEventListener('abort', stop, { once: true });
  try {
    await initializeCodex(rpc, { experimentalApi: true });
    // Ephemeral: kept in memory only, so no rollout file and nothing in the thread's history.
    // Read-only, and every approval request is declined, so nothing on disk can change.
    const settings = {
      cwd: question.session.cwd,
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      developerInstructions: INSTRUCTION.codex,
    };
    const result = from
      ? await rpc.request('thread/fork', {
          threadId: from.nativeId,
          ...(from.at ? { lastTurnId: from.at } : {}),
          // Codex refuses an ephemeral fork of a paginated thread that would copy its turns back.
          excludeTurns: true,
          ...settings,
        })
      : await rpc.request('thread/start', settings);
    threadId = result.thread.id;
    if (question.signal.aborted) return;
    const turn = await rpc.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt(question), text_elements: [] }],
      ...(question.session.model ? { model: question.session.model } : {}),
    });
    turnId = turn?.turn?.id;
    await finished;
  } finally {
    question.signal.removeEventListener('abort', stop);
    rpc.dispose();
  }
}
