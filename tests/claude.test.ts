import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AgentEvent, Session } from '../src/model';
import { ClaudeAgent } from '../src/providers/claude';
import { readClaudeTitle } from '../src/providers/claude-title';

function session(extra: Partial<Session> = {}): Session {
  return {
    id: 'fixture',
    provider: 'claude',
    title: 'Fixture',
    titleSource: 'prompt',
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}
const base = { session_id: 'native-1', uuid: 'u' };
function scripted(frames: any[], capture: { options?: any } = {}) {
  return ((params: { prompt: AsyncIterable<unknown>; options: unknown }) => {
    capture.options = params.options;
    async function* run() {
      for (const frame of frames) yield frame;
    }
    return Object.assign(run(), { close() {}, interrupt: async () => {} });
  }) as any;
}
const delta = (index: number, delta: object, parent: string | null = null) => ({
  ...base,
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_delta', index, delta },
});
const start = (id: string, parent: string | null = null) => ({
  ...base,
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'message_start', message: { id } },
});
const blockStart = (index: number, type: string, parent: string | null = null) => ({
  ...base,
  type: 'stream_event',
  parent_tool_use_id: parent,
  event: { type: 'content_block_start', index, content_block: { type } },
});
const assistant = (id: string, content: object[], parent: string | null = null) => ({
  ...base,
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { id, model: 'claude-opus-5-5', content },
});
const result = { ...base, type: 'result', is_error: false, result: 'done' };
async function run(frames: any[], extra: Partial<Session> = {}) {
  const events: AgentEvent[] = [];
  const capture: { options?: any } = {};
  const agent = new ClaudeAgent(session(extra), '/bin/claude', (event) => events.push(event), {
    query: scripted(frames, capture),
    titleRetryMs: 1,
  });
  await agent.send('hi');
  agent.dispose();
  return { events, options: capture.options };
}
test('thinking and text stream separately and reconcile with their final blocks', async () => {
  const { events } = await run([
    start('m1'),
    blockStart(0, 'thinking'),
    delta(0, { type: 'thinking_delta', thinking: 'Consider' }),
    blockStart(1, 'text'),
    delta(1, { type: 'text_delta', text: 'Hello' }),
    assistant('m1', [{ type: 'thinking', thinking: 'Consider it' }]),
    assistant('m1', [{ type: 'text', text: 'Hello there' }]),
    result,
  ]);
  const deltas = events.filter((event) => event.type === 'delta');
  assert.deepEqual(
    deltas.map((event) => [event.id, event.role]),
    [
      ['m1-0', 'thinking'],
      ['m1-1', undefined],
    ],
  );
  const finals = events.filter((event) => event.type === 'message');
  assert.deepEqual(
    finals.map((event) => [event.message.id, event.message.role, event.message.text]),
    [
      ['m1-0', 'thinking', 'Consider it'],
      ['m1-1', 'assistant', 'Hello there'],
    ],
  );
});
test('the chosen model and effort reach the CLI and thinking summaries are requested', async () => {
  const { options, events } = await run([result], { model: 'sonnet', effort: 'high' });
  assert.equal(options.model, 'sonnet');
  assert.equal(options.effort, 'high');
  assert.deepEqual(options.thinking, { type: 'adaptive', display: 'summarized' });
  assert.ok(events.some((event) => event.type === 'status' && event.status === 'completed'));
});
test('unset choices leave the CLI config alone, and no adaptive thinking is respected', async () => {
  const { options } = await run([result], { adaptiveThinking: false });
  assert.equal('model' in options, false);
  assert.equal('effort' in options, false);
  assert.equal('thinking' in options, false);
  assert.equal(options.permissionMode, undefined);
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
});
test('edits show a diff, and reported hunks replace the estimate after the tool runs', async () => {
  const { events } = await run([
    assistant('m1', [
      {
        type: 'tool_use',
        id: 'edit-1',
        name: 'Edit',
        input: { file_path: '/project/src/a.ts', old_string: 'a', new_string: 'b' },
      },
    ]),
    {
      ...base,
      type: 'user',
      parent_tool_use_id: null,
      tool_use_result: {
        filePath: '/project/src/a.ts',
        structuredPatch: [
          { oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: ['-a', '+b'] },
        ],
      },
      message: { content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }] },
    },
    result,
  ]);
  const call = events.find((event) => event.type === 'message');
  assert.equal(call?.type === 'message' && call.message.tool?.diffs?.[0].path, 'src/a.ts');
  const patch = events.find((event) => event.type === 'patch');
  assert.ok(patch?.type === 'patch');
  assert.equal(patch.tool?.status, 'completed');
  assert.match(patch.tool?.diffs?.[0].patch ?? '', /^@@ -4,1 \+4,1 @@/);
});
test('subagent output goes to its worker and an unreported worker ends as interrupted', async () => {
  const { events } = await run([
    assistant('m1', [
      { type: 'tool_use', id: 'task-a', name: 'Task', input: { description: 'Research' } },
      { type: 'tool_use', id: 'task-b', name: 'Task', input: { description: 'Other' } },
    ]),
    {
      ...base,
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'task-a',
      description: 'Research',
    },
    {
      ...base,
      type: 'system',
      subtype: 'task_started',
      task_id: 't2',
      tool_use_id: 'task-b',
      description: 'Other',
      is_backgrounded: true,
    },
    start('sub', 'task-a'),
    blockStart(0, 'text', 'task-a'),
    delta(0, { type: 'text_delta', text: 'inner' }, 'task-a'),
    {
      ...base,
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'task-a', content: 'done' }] },
    },
    result,
  ]);
  const inner = events.find((event) => event.type === 'worker' && event.inner);
  assert.equal(inner?.type === 'worker' && inner.id, 'task-a');
  assert.equal(
    events.some((event) => event.type === 'delta'),
    false,
  );
  const statuses = events.filter((event) => event.type === 'worker' && event.status);
  assert.ok(
    statuses.some((e) => e.type === 'worker' && e.id === 'task-a' && e.status === 'completed'),
  );
  assert.ok(
    statuses.some((e) => e.type === 'worker' && e.id === 'task-b' && e.status === 'interrupted'),
  );
});
test('the Claude session name is read from its transcript; a rename wins', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-title-read-'));
  const cwd = '/some/my.project';
  const folder = path.join(root, 'projects', '-some-my-project');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'abc.jsonl');
  const ai = JSON.stringify({ type: 'ai-title', aiTitle: 'Fix login', sessionId: 'abc' });
  await writeFile(file, `{"type":"user"}\n${ai}\n{"partial`);
  const env = { CLAUDE_CONFIG_DIR: root };
  assert.equal(await readClaudeTitle('abc', cwd, env), 'Fix login');
  assert.equal(await readClaudeTitle('missing', cwd, env), undefined);
  const custom = JSON.stringify({ type: 'custom-title', customTitle: 'Mine', sessionId: 'abc' });
  await writeFile(file, `${ai}\n${custom}\n`);
  assert.equal(await readClaudeTitle('abc', cwd, env), 'Mine');
});

test('Claude plan mode: the plan is pinned, and only your answer releases the request', async () => {
  const capture: { options?: any } = {};
  let permission: any;
  const query = ((params: any) => {
    capture.options = params.options;
    permission = params.options.canUseTool;
    async function* run() {
      yield { ...base, type: 'result', subtype: 'success', is_error: false, result: '' };
    }
    return Object.assign(run(), { close() {}, interrupt: async () => {} });
  }) as any;
  const events: AgentEvent[] = [];
  const agent = new ClaudeAgent(
    session({ mode: 'plan' }),
    'claude',
    (event) => events.push(event),
    { query },
  );
  await agent.send('Plan it');
  assert.equal(capture.options.permissionMode, 'plan');
  const signal = new AbortController().signal;
  const decision = permission('ExitPlanMode', { plan: '# The plan' }, { signal, toolUseID: 'x' });
  await new Promise((resolve) => setImmediate(resolve));
  const plan = events.find((event) => event.type === 'plan') as any;
  assert.deepEqual([plan.text, plan.final], ['# The plan', true]);
  const request = events.find((event) => event.type === 'approval') as any;
  assert.equal(request.approval.kind, 'plan');
  request.respond(false, {});
  assert.equal((await decision).behavior, 'deny');

  // Without inline text, the card says so rather than showing an empty plan.
  events.length = 0;
  const second = permission('ExitPlanMode', {}, { signal, toolUseID: 'y' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match((events.find((event) => event.type === 'plan') as any).text, /did not share/);
  (events.find((event) => event.type === 'approval') as any).respond(true, {});
  assert.equal((await second).behavior, 'allow');
});

test('Claude receives attached images as content blocks and is told of the size limit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-claude-image-'));
  const small = path.join(root, 'small.png');
  await writeFile(small, Buffer.from('png-bytes'));
  let first: any;
  const query = ((params: any) => {
    async function* run() {
      for await (const message of params.prompt) {
        first = message;
        yield { ...base, type: 'result', subtype: 'success', is_error: false, result: '' };
        break;
      }
    }
    return Object.assign(run(), { close() {}, interrupt: async () => {} });
  }) as any;
  const agent = new ClaudeAgent(session(), 'claude', () => {}, { query });
  await agent.send('Look', [{ path: small, mediaType: 'image/png' }]);
  assert.deepEqual(first.message.content, [
    { type: 'text', text: 'Look' },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from('png-bytes').toString('base64'),
      },
    },
  ]);
  const large = path.join(root, 'large.png');
  await writeFile(large, Buffer.alloc(5 * 1024 * 1024 + 1));
  await assert.rejects(agent.send('Look', [{ path: large, mediaType: 'image/png' }]), /5 MB/);
});
test('usage falls back to the last response when the CLI cannot answer, and a failure is harmless', async () => {
  const { events } = await run([
    {
      ...assistant('m1', [{ type: 'text', text: 'Hi' }]),
      message: {
        id: 'm1',
        model: 'claude-x',
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 20 },
      },
    },
    { ...result, modelUsage: { 'claude-x': { contextWindow: 1000 } } },
  ]);
  const usage = events.find((event) => event.type === 'usage');
  assert.deepEqual(usage && 'context' in usage ? usage.context : undefined, {
    used: 120,
    max: 1000,
  });
  assert.equal(events.at(-1)?.type === 'status' || events.some((e) => e.type === 'status'), true);
});
test('a question keeps option details and multiple choice', async () => {
  const seen: AgentEvent[] = [];
  let can: any;
  const query = ((params: any) => {
    can = params.options.canUseTool;
    async function* run() {}
    return Object.assign(run(), { close() {}, interrupt: async () => {} });
  }) as any;
  const agent = new ClaudeAgent(session(), '/bin/claude', (event) => seen.push(event), { query });
  await agent.send('hi');
  void can(
    'AskUserQuestion',
    {
      questions: [
        {
          question: 'Which?',
          multiSelect: true,
          options: [{ label: 'A', description: 'First' }, { label: 'B' }],
        },
      ],
    },
    { signal: new AbortController().signal, toolUseID: 't' },
  );
  const request = seen.find((event) => event.type === 'approval');
  assert.ok(request?.type === 'approval');
  assert.deepEqual(request.approval.questions?.[0], {
    id: 'Which?',
    prompt: 'Which?',
    options: ['A', 'B'],
    details: { A: 'First' },
    multiple: true,
  });
  agent.dispose();
});
