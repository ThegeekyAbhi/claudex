import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImageStore } from '../src/attachments';
import type { AgentEvent, Session } from '../src/model';
import { CodexAgent } from '../src/providers/codex';

function required<T>(value: T | undefined): T {
  assert.ok(value);
  return value;
}
async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the fixture.');
}

test('Codex adapter completes its handshake and routes approvals and worker identities', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-codex-fixture-'));
  const executable = path.join(root, 'fake-codex');
  await writeFile(
    executable,
    `#!${process.execPath}
const lines = require('readline').createInterface({ input: process.stdin });
function emit(value) { console.log(JSON.stringify(value)); }
lines.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') emit({ id: m.id, result: {} });
  if (m.method === 'thread/start') emit({ id: m.id, result: { thread: { id: 'native-root' } } });
  if (m.method === 'turn/start') {
    emit({ id: m.id, result: { turn: { id: 'turn-one' } } });
    emit({ method: 'turn/started', params: { threadId: 'native-root', turn: { id: 'turn-one' } } });
    emit({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'native-root', command: 'echo test', reason: 'test' } });
  }
  if (m.id === 'approval-1' && m.result?.decision === 'decline') {
    emit({ method: 'item/completed', params: { threadId: 'native-root', item: { id: 'collab', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['worker-id'], agentsStates: { 'worker-id': { status: 'completed' } } } } });
    emit({ method: 'item/agentMessage/delta', params: { threadId: 'native-root', itemId: 'answer', delta: 'Done' } });
    emit({ method: 'item/completed', params: { threadId: 'native-root', item: { id: 'answer', type: 'agentMessage', text: 'Done' } } });
    emit({ method: 'turn/completed', params: { threadId: 'native-root', turn: { id: 'turn-one', status: 'completed' } } });
  }
});
`,
    { mode: 0o700 },
  );
  const session: Session = {
    id: 'fixture',
    provider: 'codex',
    title: 'Fixture',
    cwd: root,
    workspace: root,
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const events: AgentEvent[] = [];
  let complete: () => void = () => {};
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const agent = new CodexAgent(session, executable, (event) => {
    events.push(event);
    if (event.type === 'approval') event.respond(false, {});
    if (event.type === 'status' && event.status === 'completed') complete();
  });
  try {
    await agent.send('test');
    await Promise.race([
      completed,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Fixture timed out')), 3000).unref();
      }),
    ]);
    assert.ok(events.some((event) => event.type === 'nativeId' && event.id === 'native-root'));
    assert.ok(
      events.some((event) => event.type === 'approval' && event.approval.title === 'Run command?'),
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === 'worker' && event.id === 'worker-id' && event.status === 'completed',
      ),
    );
    assert.ok(events.some((event) => event.type === 'message' && event.message.text === 'Done'));
  } finally {
    agent.dispose();
  }
});

function fixture(script: string) {
  return (async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'aw-codex-more-'));
    const executable = path.join(root, 'fake-codex');
    await writeFile(
      executable,
      `#!${process.execPath}
const lines = require('readline').createInterface({ input: process.stdin });
function emit(value) { console.log(JSON.stringify(value)); }
const root = 'native-root';
lines.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') emit({ id: m.id, result: {} });
  if (m.method === 'thread/start') {
    require('fs').writeFileSync(${JSON.stringify(path.join(root, 'start.json'))}, JSON.stringify(m.params));
    emit({ id: m.id, result: { thread: { id: root, name: null }, model: 'gpt-configured' } });
  }
  if (m.method === 'turn/start') {
    require('fs').writeFileSync(${JSON.stringify(path.join(root, 'turn.json'))}, JSON.stringify(m.params));
    emit({ id: m.id, result: { turn: { id: 't1' } } });
    ${script}
  }
  if (m.id === 'call-1' && m.result) {
    require('fs').writeFileSync(${JSON.stringify(path.join(root, 'reply.json'))}, JSON.stringify(m.result));
    emit({ method: 'turn/completed', params: { threadId: root, turn: { id: 't1', status: 'completed' } } });
  }
});
`,
      { mode: 0o700 },
    );
    return { root, executable };
  })();
}
function codexSession(root: string, extra: Partial<Session> = {}): Session {
  return {
    id: 'fixture',
    provider: 'codex',
    title: 'Fixture',
    cwd: root,
    workspace: root,
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}
async function untilDone(events: AgentEvent[]) {
  for (let i = 0; i < 300; i++) {
    if (events.some((e) => e.type === 'status' && e.status !== 'running')) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture timed out');
}
test('Codex receives the chosen model and effort, and streams thinking, diffs, and names', async () => {
  const { root, executable } = await fixture(`
    const p = { threadId: root, turnId: 't1' };
    emit({ method: 'thread/name/updated', params: { threadId: root, threadName: 'Fix login' } });
    emit({ method: 'item/reasoning/summaryTextDelta', params: { ...p, itemId: 'r1', delta: 'Consider', summaryIndex: 0 } });
    emit({ method: 'item/completed', params: { threadId: root, item: { id: 'r1', type: 'reasoning', summary: ['Consider it'], content: [] } } });
    emit({ method: 'item/completed', params: { threadId: root, item: { id: 'c1', type: 'commandExecution', command: "/bin/zsh -lc 'false'", status: 'completed', exitCode: 1, aggregatedOutput: 'no', commandActions: [] } } });
    emit({ method: 'item/completed', params: { threadId: root, item: { id: 'f1', type: 'fileChange', status: 'completed', changes: [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\\n-a\\n+b' }, { path: 'new.ts', kind: { type: 'add' }, diff: 'hello' }] } } });
    emit({ method: 'turn/completed', params: { threadId: root, turn: { id: 't1', status: 'completed' } } });
  `);
  const events: AgentEvent[] = [];
  const agent = new CodexAgent(
    codexSession(root, { model: 'gpt-6.1-sol', effort: 'high' }),
    executable,
    (event) => events.push(event),
  );
  try {
    await agent.send('go');
    await untilDone(events);
    const turn = JSON.parse(await readFile(path.join(root, 'turn.json'), 'utf8'));
    assert.equal(turn.model, 'gpt-6.1-sol');
    assert.equal(turn.effort, 'high');
    assert.equal(turn.summary, 'auto');
    const start = JSON.parse(await readFile(path.join(root, 'start.json'), 'utf8'));
    assert.equal(start.dynamicTools, undefined, 'no tool without a delegate');
    assert.ok(events.some((e) => e.type === 'title' && e.title === 'Fix login'));
    assert.ok(events.some((e) => e.type === 'activeModel' && e.model === 'gpt-configured'));
    assert.ok(events.some((e) => e.type === 'delta' && e.role === 'thinking'));
    const messages = events.flatMap((e) => (e.type === 'message' ? [e.message] : []));
    assert.equal(messages.find((m) => m.id === 'r1')?.text, 'Consider it');
    const command = messages.find((m) => m.id === 'c1');
    assert.equal(command?.tool?.title, 'false');
    assert.equal(command?.tool?.status, 'failed', 'a non-zero exit is not success');
    const diffs = messages.find((m) => m.id === 'f1')?.tool?.diffs;
    assert.deepEqual(
      diffs?.map((d) => [d.path, d.kind, d.additions, d.deletions]),
      [
        ['a.ts', 'update', 1, 1],
        ['new.ts', 'add', 1, 0],
      ],
    );
  } finally {
    agent.dispose();
  }
});
const toolCall = `emit({ id: 'call-1', method: 'item/tool/call', params: { threadId: root, turnId: 't1', callId: 'cid', tool: 'run_agent', arguments: { agent: 'claude2', prompt: 'Review it' } } });`;
test('Codex run_agent asks first, then runs the agent and returns its real result', async () => {
  const { root, executable } = await fixture(toolCall);
  const events: AgentEvent[] = [];
  const requests: unknown[] = [];
  const agent = new CodexAgent(
    codexSession(root),
    executable,
    (event) => {
      events.push(event);
      if (event.type === 'approval') {
        assert.equal(event.approval.title, 'Run Claude 2 agent?');
        assert.equal(requests.length, 0, 'nothing runs before approval');
        event.respond(true, {});
      }
    },
    {
      delegate: async (request, onStart) => {
        requests.push(request);
        onStart?.('child-session');
        return { sessionId: 'child-session', status: 'completed', text: 'All good' };
      },
    },
  );
  try {
    await agent.send('go');
    await untilDone(events);
    const start = JSON.parse(await readFile(path.join(root, 'start.json'), 'utf8'));
    assert.equal(start.dynamicTools[0].name, 'run_agent');
    assert.deepEqual(requests, [
      { agent: 'claud2', prompt: 'Review it', model: undefined, effort: undefined },
    ]);
    const reply = JSON.parse(await readFile(path.join(root, 'reply.json'), 'utf8'));
    assert.equal(reply.success, true);
    assert.match(reply.contentItems[0].text, /All good/);
    assert.ok(events.some((e) => e.type === 'patch' && e.tool?.workerId === 'child-session'));
  } finally {
    agent.dispose();
  }
});
test('declining run_agent starts nothing and tells Codex it was declined', async () => {
  const { root, executable } = await fixture(toolCall);
  const events: AgentEvent[] = [];
  let started = false;
  const agent = new CodexAgent(
    codexSession(root),
    executable,
    (event) => {
      events.push(event);
      if (event.type === 'approval') event.respond(false, {});
    },
    {
      delegate: async () => {
        started = true;
        return { sessionId: 'x', status: 'completed', text: '' };
      },
    },
  );
  try {
    await agent.send('go');
    await untilDone(events);
    assert.equal(started, false);
    const reply = JSON.parse(await readFile(path.join(root, 'reply.json'), 'utf8'));
    assert.equal(reply.success, false);
    assert.match(reply.contentItems[0].text, /Declined/);
    assert.ok(events.some((e) => e.type === 'patch' && e.tool?.status === 'declined'));
  } finally {
    agent.dispose();
  }
});
test('a child thread without the tool refuses a stray run_agent call', async () => {
  const { root, executable } = await fixture(toolCall);
  const events: AgentEvent[] = [];
  const agent = new CodexAgent(codexSession(root), executable, (event) => events.push(event));
  try {
    await agent.send('go');
    await untilDone(events);
    const reply = JSON.parse(await readFile(path.join(root, 'reply.json'), 'utf8'));
    assert.equal(reply.success, false);
    assert.equal(
      events.some((e) => e.type === 'approval'),
      false,
    );
  } finally {
    agent.dispose();
  }
});

test('Codex plan mode, images in and out: real payloads, stored images, truthful failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-codex-plan-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAI', 'base64').toString('base64');
  const saved = path.join(root, 'generated.png');
  await writeFile(saved, Buffer.from(png, 'base64'));
  const log = path.join(root, 'turns.log');
  const executable = path.join(root, 'fake-codex');
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('fs');
const lines = require('readline').createInterface({ input: process.stdin });
const emit = (value) => console.log(JSON.stringify(value));
const on = (method, item) => emit({ method, params: { threadId: 'n', item } });
lines.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') emit({ id: m.id, result: {} });
  if (m.method === 'thread/start') emit({ id: m.id, result: { thread: { id: 'n' }, model: 'gpt-x' } });
  if (m.method === 'turn/start') {
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(m.params) + '\\n');
    emit({ id: m.id, result: { turn: { id: 't' } } });
    emit({ method: 'item/plan/delta', params: { threadId: 'n', itemId: 'p', delta: '# Pl' } });
    on('item/completed', { id: 'p', type: 'plan', text: '# Plan' });
    on('item/started', { id: 'g1', type: 'imageGeneration', status: 'generating', revisedPrompt: 'A cat' });
    on('item/completed', { id: 'g1', type: 'imageGeneration', status: 'done', revisedPrompt: 'A cat', savedPath: ${JSON.stringify(saved)} });
    on('item/completed', { id: 'g2', type: 'imageGeneration', result: ${JSON.stringify(png)} });
    on('item/completed', { id: 'g3', type: 'imageGeneration', failure: { type: 'usageLimitExceeded', limitId: 'l', resetsAt: null } });
    on('item/completed', { id: 'g4', type: 'imageGeneration', result: 'bm90IGFuIGltYWdl' });
    on('item/completed', { id: 'v1', type: 'imageView', path: '/outside/secret.png' });
  }
});
`,
    { mode: 0o700 },
  );
  const fixture: Session = {
    id: 'fixture',
    provider: 'codex',
    title: 'Fixture',
    cwd: root,
    workspace: root,
    status: 'idle',
    mode: 'plan',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const events: AgentEvent[] = [];
  const store = new ImageStore(path.join(root, 'store'));
  const agent = new CodexAgent(fixture, executable, (event) => events.push(event), {
    images: store,
  });
  const imageOf = (id: string) =>
    events.flatMap((event) =>
      event.type === 'message' && event.message.id === id && event.message.image
        ? [event.message.image]
        : [],
    );
  try {
    await agent.send('Plan', [{ path: '/tmp/a.png', mediaType: 'image/png' }]);
    await waitFor(
      () =>
        imageOf('g4').length > 0 &&
        events.some((e) => e.type === 'message' && e.message.id === 'v1') &&
        imageOf('g2').length > 0 &&
        imageOf('g1').length > 1,
    );
    const turn = JSON.parse((await readFile(log, 'utf8')).trim());
    assert.deepEqual(turn.input[1], { type: 'localImage', path: '/tmp/a.png' });
    assert.deepEqual(turn.collaborationMode, {
      mode: 'plan',
      settings: { model: 'gpt-x', reasoning_effort: null, developer_instructions: null },
    });
    const plans = events.filter((event) => event.type === 'plan') as any[];
    assert.deepEqual(
      plans.map((event) => [event.text, event.final]),
      [
        ['# Pl', false],
        ['# Plan', true],
      ],
    );
    assert.ok(
      !events.some((event) => event.type === 'message' && event.message.id === 'p'),
      'a plan is not repeated as a message',
    );
    assert.equal(imageOf('g1')[0].status, 'generating');
    assert.equal(imageOf('g1')[1].status, 'ready');
    assert.match(required(imageOf('g1')[1].file), /\.png$/);
    assert.equal(imageOf('g2')[0].status, 'ready');
    assert.match(required(imageOf('g3')[0].failure), /limit/);
    assert.match(required(imageOf('g4')[0].failure), /Only PNG/);
    // An image outside the workspace is named, never copied in for display.
    assert.equal(imageOf('v1').length, 0);
  } finally {
    agent.dispose();
  }
});
