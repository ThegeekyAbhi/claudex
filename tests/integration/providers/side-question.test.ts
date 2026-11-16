import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askClaude,
  askCodex,
  codexActivity,
  sideQuestionInstruction,
} from '../../../src/providers/side-question';
import { buildPacket } from '../../../src/shared/domain/session-packet';
import type { Session } from '../../../src/shared/model';

test('a Claude side question branches without saving, with no tools, and streams its text', async () => {
  let seen: any;
  const query: any = (request: any) => {
    seen = request;
    return (async function* () {
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Yes, ' },
        },
      };
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'it is.' },
        },
      };
      yield { type: 'result', is_error: false, result: 'Yes, it is.' };
    })();
  };
  let text = '';
  await askClaude(
    {
      session: { provider: 'claude', cwd: '/x', nativeId: 'native-1' },
      launcher: { executable: 'claude' },
      text: 'Is the cache warm?',
      earlier: [{ question: 'Which cache?', answer: 'The skill cache.' }],
      onText: (delta) => {
        text += delta;
      },
      signal: new AbortController().signal,
    },
    query,
  );
  assert.equal(text, 'Yes, it is.');
  assert.equal(seen.options.resume, 'native-1');
  assert.equal(seen.options.forkSession, true);
  assert.equal(seen.options.persistSession, false);
  assert.deepEqual(seen.options.tools, []);
  assert.equal(seen.options.maxTurns, 1);
  assert.deepEqual(seen.options.settingSources, []);
  assert.match(seen.prompt, /Which cache\?[\s\S]*Is the cache warm\?$/);
  assert.deepEqual(await seen.options.canUseTool('Bash', {}, {}), {
    behavior: 'deny',
    message: 'Side questions answer without tools.',
  });
});

test('a Claude side question reports a failed answer instead of an empty one', async () => {
  const query: any = () =>
    (async function* () {
      yield { type: 'result', is_error: true, errors: ['rate limited'] };
    })();
  await assert.rejects(
    askClaude(
      {
        session: { provider: 'claude', cwd: '/x' },
        launcher: { executable: 'claude' },
        text: 'q',
        onText: () => {},
        signal: new AbortController().signal,
      },
      query,
    ),
    /rate limited/,
  );
});

test('a new chat’s context stops at the chosen message', () => {
  const source = {
    id: 's',
    provider: 'claude',
    title: 'Source',
    cwd: '/x',
    workspace: '/x',
    status: 'completed',
    createdAt: 0,
    updatedAt: 0,
    messages: [
      { id: 'u1', role: 'user', text: 'early question' },
      { id: 'a1', role: 'assistant', text: 'early answer' },
      { id: 'u2', role: 'user', text: 'later question' },
    ],
  } as Session;
  const packet = buildPacket(source, { history: 'recent', upTo: 'a1' });
  assert.match(packet.text, /early answer/);
  assert.doesNotMatch(packet.text, /later question/);
  assert.equal(packet.through, 'a1');
});

test('context up to a message that is gone is refused, not widened to the whole thread', () => {
  const source = {
    id: 's',
    provider: 'claude',
    title: 'Source',
    cwd: '/x',
    workspace: '/x',
    status: 'completed',
    createdAt: 0,
    updatedAt: 0,
    messages: [{ id: 'u1', role: 'user', text: 'early question' }],
  } as Session;
  assert.throws(
    () => buildPacket(source, { history: 'recent', upTo: 'removed' }),
    /no longer in the thread/,
  );
});

test('a plan is part of the context only if it began within the kept history', () => {
  const source = {
    id: 's',
    provider: 'claude',
    title: 'Source',
    cwd: '/x',
    workspace: '/x',
    status: 'completed',
    createdAt: 0,
    updatedAt: 0,
    messages: [
      { id: 'u1', role: 'user', text: 'early question' },
      { id: 'a1', role: 'assistant', text: 'early answer' },
      { id: 'u2', role: 'user', text: 'make a plan' },
      { id: 'a2', role: 'assistant', text: 'here it is' },
    ],
    plan: { text: 'Secret later plan', status: 'ready', updatedAt: 0, after: 'a2' },
  } as Session;
  assert.doesNotMatch(
    buildPacket(source, { history: 'recent', upTo: 'a1' }).text,
    /Secret later plan/,
  );
  assert.match(buildPacket(source, { history: 'recent', upTo: 'a2' }).text, /Secret later plan/);
  assert.match(buildPacket(source, { history: 'recent' }).text, /Secret later plan/);
  const { after: _, ...unanchored } = source.plan as NonNullable<Session['plan']>;
  assert.doesNotMatch(
    buildPacket({ ...source, plan: unanchored }, { history: 'recent', upTo: 'a2' }).text,
    /Secret later plan/,
  );
});

/** A stand-in for Codex's app server: answers requests, and lets the test send notifications. */
function fakeCodex(script: (method: string, params: any, notify: (message: any) => void) => any) {
  const requests: { method: string; params: any }[] = [];
  const connect = (onMessage: (message: any) => void) => ({
    request: async (method: string, params: any) => {
      requests.push({ method, params });
      return script(method, params, (message) => queueMicrotask(() => onMessage(message)));
    },
    write: () => {},
    reply: () => {},
    dispose: () => {},
  });
  return { requests, connect: connect as any };
}

test('a Codex side question forks ephemerally without copying turns, and reports what it read', async () => {
  const codex = fakeCodex((method, _params, notify) => {
    if (method === 'thread/fork') return { thread: { id: 'side' } };
    if (method === 'turn/start') {
      notify({
        method: 'item/started',
        params: {
          threadId: 'side',
          item: {
            type: 'commandExecution',
            command: 'cat src/a.ts',
            commandActions: [{ type: 'read', path: 'src/a.ts' }],
          },
        },
      });
      notify({ method: 'item/agentMessage/delta', params: { threadId: 'side', delta: 'It is.' } });
      notify({
        method: 'turn/completed',
        params: { threadId: 'side', turn: { status: 'completed' } },
      });
      return { turn: { id: 'turn-1' } };
    }
    return {};
  });
  let text = '';
  const activity: string[] = [];
  await askCodex(
    {
      session: { provider: 'codex', cwd: '/x', nativeId: 'thread-1' },
      launcher: { executable: 'codex' },
      text: 'Is it?',
      onText: (delta) => {
        text += delta;
      },
      onActivity: (label) => activity.push(label),
      signal: new AbortController().signal,
    },
    codex.connect,
  );
  const fork = codex.requests.find((item) => item.method === 'thread/fork');
  assert.equal(fork?.params.threadId, 'thread-1');
  assert.equal(fork?.params.ephemeral, true);
  assert.equal(fork?.params.excludeTurns, true);
  assert.equal(fork?.params.sandbox, 'read-only');
  assert.equal(fork?.params.approvalPolicy, 'never');
  assert.equal(text, 'It is.');
  assert.deepEqual(activity, ['Read src/a.ts']);
});

test('Codex may read to answer a side question; Claude answers without tools', () => {
  assert.match(sideQuestionInstruction('codex'), /may read files/);
  assert.match(sideQuestionInstruction('claude'), /Do not use tools/);
  assert.equal(codexActivity({ type: 'agentMessage' }), undefined);
  assert.equal(
    codexActivity({ type: 'webSearch', query: 'zod v4' }),
    'Searched the web for zod v4',
  );
});
