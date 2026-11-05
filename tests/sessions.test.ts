import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Delegate, EventSink } from '../src/core/model';
import { createAgentFactory, Sessions } from '../src/harness/session-manager';

async function waitUntil(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (ready()) return;
    await delay(5);
  }
  assert.fail('Provider did not start');
}

function required<T>(value: T | undefined): T {
  assert.ok(value);
  return value;
}

test('concurrent sessions isolate messages and approvals, including overlapping requests', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-sessions-'));
  const emitters = new Map<string, EventSink>();
  const manager = new Sessions(storage, (session, emit) => {
    emitters.set(session.id, emit);
    return { send: async () => {}, interrupt: async () => {}, dispose() {} };
  });
  const first = manager.create('codex', storage, storage, 'One');
  const second = manager.create('claude', storage, storage, 'Two');
  await Promise.all([manager.send(first.id, 'first'), manager.send(second.id, 'second')]);
  required(emitters.get(first.id))({ type: 'delta', id: 'same-id', text: 'A' });
  required(emitters.get(second.id))({ type: 'delta', id: 'same-id', text: 'B' });
  const results: string[] = [];
  required(emitters.get(first.id))({
    type: 'approval',
    approval: { id: 'r1', title: 'One?', detail: '' },
    respond: (allowed) => results.push(`one:${allowed}`),
  });
  required(emitters.get(first.id))({
    type: 'approval',
    approval: { id: 'r2', title: 'Two?', detail: '' },
    respond: (allowed) => results.push(`two:${allowed}`),
  });
  assert.equal(first.approval?.id, 'r1');
  manager.approve(first.id, 'r1', false, {});
  assert.equal(first.approval?.id, 'r2');
  manager.approve(first.id, 'r2', true, {});
  assert.deepEqual(results, ['one:false', 'two:true']);
  assert.equal(first.status, 'running');
  assert.equal(first.messages.at(-1)?.text, 'A');
  assert.equal(second.messages.at(-1)?.text, 'B');
  assert.throws(() => manager.approve(second.id, 'r1', true, {}));
  await assert.rejects(() => manager.send(first.id, 'duplicate'));
  await manager.dispose();
});
test('worker events remain owned by the parent and cannot be sent user turns', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-workers-'));
  let sink: EventSink | undefined;
  const manager = new Sessions(storage, (_session, emit) => {
    sink = emit;
    return { send: async () => {}, interrupt: async () => {}, dispose() {} };
  });
  const lead = manager.create('codex', storage, storage, 'Lead');
  await manager.send(lead.id, 'work');
  required(sink)({ type: 'worker', id: 'native-worker', title: 'Worker', status: 'running' });
  required(sink)({ type: 'worker', id: 'native-worker', title: 'Worker', status: 'completed' });
  assert.equal(manager.sessions.length, 2);
  const worker = manager.sessions[1];
  assert.equal(worker.parentId, lead.id);
  assert.equal(worker.status, 'completed');
  await assert.rejects(() => manager.send(worker.id, 'steal worker'));
  await manager.dispose();
});
test('failed providers expose errors and persistence restores without launching processes', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-recovery-'));
  let started = 0;
  const manager = new Sessions(storage, () => {
    started++;
    return {
      send: async () => {
        throw new Error('Missing CLI');
      },
      interrupt: async () => {},
      dispose() {},
    };
  });
  const first = manager.create('claude', storage, storage, 'Failure');
  await manager.send(first.id, 'go');
  assert.equal(first.status, 'failed');
  assert.match(required(first.messages.at(-1)).text, /Missing CLI/);
  await manager.flush();
  const persisted = JSON.parse(await readFile(path.join(storage, 'sessions.json'), 'utf8'));
  assert.equal(persisted.sessions[0].approval, undefined);
  const restored = new Sessions(storage, () => {
    throw new Error('Must not spawn on restore');
  });
  await restored.load();
  assert.equal(started, 1);
  assert.equal(restored.sessions[0].status, 'failed');
  await manager.dispose();
  await restored.dispose();
});
test('interrupt clears approvals and forwards interruption to the correct process', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-stop-'));
  let interrupted = false;
  let sink: EventSink | undefined;
  const manager = new Sessions(storage, (_session, emit) => {
    sink = emit;
    return {
      send: async () => {},
      interrupt: async () => {
        interrupted = true;
      },
      dispose() {},
    };
  });
  const first = manager.create('codex', storage, storage, 'Stop');
  await manager.send(first.id, 'go');
  required(sink)({
    type: 'approval',
    approval: { id: 'pending', title: 'Run?', detail: '' },
    respond() {},
  });
  await manager.interrupt(first.id);
  assert.equal(interrupted, true);
  assert.equal(first.status, 'interrupted');
  assert.equal(first.approval, undefined);
  assert.throws(() => manager.approve(first.id, 'pending', true, {}));
  await manager.dispose();
});

test('late failures and events from stopped agents cannot overwrite a resumed turn', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-late-'));
  const sinks: EventSink[] = [];
  let rejectOld: (error: Error) => void = () => {};
  let calls = 0;
  let oldStarted = false;
  const manager = new Sessions(storage, (_session, emit) => {
    sinks.push(emit);
    const first = calls++ === 0;
    return {
      send: () =>
        first
          ? new Promise<void>((_resolve, reject) => {
              rejectOld = reject;
              oldStarted = true;
            })
          : Promise.resolve(),
      interrupt: async () => {},
      dispose() {},
    };
  });
  const item = manager.create('codex', storage, storage, 'Resume');
  const oldTurn = manager.send(item.id, 'old');
  await waitUntil(() => oldStarted);
  await manager.interrupt(item.id);
  await manager.send(item.id, 'new');
  sinks[0]({ type: 'status', status: 'failed' });
  rejectOld(new Error('Old process closed'));
  await oldTurn;
  assert.equal(item.status, 'running');
  assert.equal(
    item.messages.some((message) => message.text.includes('Old process closed')),
    false,
  );
  await manager.dispose();
});

test('ongoing output is checkpointed before a long-running turn completes', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-checkpoint-'));
  let sink: EventSink | undefined;
  const manager = new Sessions(storage, (_session, emit) => {
    sink = emit;
    return { send: async () => {}, interrupt: async () => {}, dispose() {} };
  });
  const item = manager.create('codex', storage, storage, 'Long running');
  await manager.send(item.id, 'go');
  required(sink)({ type: 'nativeId', id: 'recoverable-native-id' });
  const timer = setInterval(() => required(sink)({ type: 'delta', id: 'answer', text: '.' }), 30);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1700));
    const data = JSON.parse(await readFile(path.join(storage, 'sessions.json'), 'utf8'));
    assert.equal(data.sessions[0].nativeId, 'recoverable-native-id');
    assert.equal(data.sessions[0].status, 'running');
    assert.ok(data.sessions[0].messages.some((message: { id: string }) => message.id === 'answer'));
  } finally {
    clearInterval(timer);
    await manager.dispose();
  }
});

test('Claude sessions route to their saved launcher independently', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-launchers-'));
  const manager = new Sessions(storage, () => {
    throw new Error('unused');
  });
  const first = manager.create('claude', storage, storage, 'Primary', undefined, 'claude');
  const second = manager.create('claude', storage, storage, 'Secondary', undefined, 'claud2');
  const commands: string[] = [];
  const factory = createAgentFactory((provider, command) => {
    commands.push(command ?? provider);
    return command ?? provider;
  });
  factory(first, () => {}).dispose();
  factory(second, () => {}).dispose();
  assert.deepEqual(commands, ['claude', 'claud2']);
  await manager.dispose();
  const restored = new Sessions(storage, factory);
  await restored.load();
  assert.equal(restored.get(second.id).claudeCommand, 'claud2');
  await restored.dispose();
});

function delegationHarness(storageName: string) {
  return (async () => {
    const storage = await mkdtemp(path.join(tmpdir(), storageName));
    const sinks = new Map<string, EventSink>();
    const delegates = new Map<string, Delegate | undefined>();
    const sent = new Map<string, string>();
    const interrupted: string[] = [];
    const manager = new Sessions(storage, (session, emit, delegate) => {
      sinks.set(session.id, emit);
      delegates.set(session.id, delegate);
      return {
        send: async (text) => {
          sent.set(session.id, text);
        },
        interrupt: async () => {
          interrupted.push(session.id);
        },
        dispose() {},
      };
    });
    return { manager, sinks, delegates, sent, interrupted, storage };
  })();
}
test('a delegated agent runs as a child thread and reports its real outcome', async () => {
  const { manager, sinks, sent, storage } = await delegationHarness('aw-delegate-');
  const lead = manager.create('codex', storage, storage, 'Lead');
  let childId = '';
  const pending = manager.delegate(
    lead.id,
    { agent: 'claud2', prompt: 'Review this\nthoroughly', model: 'sonnet' },
    (id) => {
      childId = id;
    },
  );
  await waitUntil(() => sent.has(childId));
  const child = manager.get(childId);
  assert.equal(child.parentId, lead.id);
  assert.equal(child.provider, 'claude');
  assert.equal(child.claudeCommand, 'claud2');
  assert.equal(child.model, 'sonnet');
  assert.equal(child.title, 'Review this');
  assert.equal(child.delegated, true);
  assert.equal(child.observed, undefined);
  assert.equal(sent.get(childId), 'Review this\nthoroughly');
  const emit = required(sinks.get(childId));
  emit({ type: 'message', message: { id: 'a', role: 'assistant', text: 'Looks good.' } });
  emit({ type: 'status', status: 'failed' });
  assert.deepEqual(await pending, { sessionId: childId, status: 'failed', text: 'Looks good.' });
  await manager.dispose();
});
test('delegation cannot chain: child threads are not given the delegate tool', async () => {
  const { manager, delegates, storage } = await delegationHarness('aw-depth-');
  const lead = manager.create('codex', storage, storage, 'Lead');
  await manager.send(lead.id, 'go');
  assert.equal(typeof delegates.get(lead.id), 'function');
  let childId = '';
  void required(delegates.get(lead.id))({ agent: 'codex', prompt: 'task' }, (id) => {
    childId = id;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(delegates.has(childId));
  assert.equal(delegates.get(childId), undefined);
  await manager.dispose();
});
test('a thread linked by the user can still delegate; only delegated agents cannot', async () => {
  const { manager, delegates, storage } = await delegationHarness('aw-linked-');
  const lead = manager.create('codex', storage, storage, 'Lead');
  const linked = manager.create('claude', storage, storage, 'Linked', lead.id);
  await manager.send(linked.id, 'go');
  assert.equal(typeof delegates.get(linked.id), 'function');
  await manager.dispose();
});
test('stopping a lead stops its running delegate and truthfully ends the wait', async () => {
  const { manager, interrupted, storage } = await delegationHarness('aw-stop-delegate-');
  const lead = manager.create('codex', storage, storage, 'Lead');
  await manager.send(lead.id, 'go');
  let childId = '';
  const pending = manager.delegate(lead.id, { agent: 'codex', prompt: 'task' }, (id) => {
    childId = id;
  });
  await new Promise((resolve) => setImmediate(resolve));
  await manager.interrupt(lead.id);
  const result = await pending;
  assert.equal(result.status, 'interrupted');
  assert.ok(interrupted.includes(childId));
  assert.ok(interrupted.includes(lead.id));
  await manager.dispose();
});
test('provider titles replace prompt titles but never a user rename', async () => {
  const { manager, sinks, storage } = await delegationHarness('aw-title-');
  const item = manager.create('claude', storage, storage, 'fix the thing');
  await manager.send(item.id, 'fix the thing');
  required(sinks.get(item.id))({ type: 'title', title: 'Fix login redirect' });
  assert.equal(item.title, 'Fix login redirect');
  manager.setTitle(item.id, 'My name');
  required(sinks.get(item.id))({ type: 'title', title: 'Later provider name' });
  assert.equal(item.title, 'My name');
  await manager.dispose();
});
test('worker transcripts stay in the worker, not the lead', async () => {
  const { manager, sinks, storage } = await delegationHarness('aw-worker-transcript-');
  const lead = manager.create('claude', storage, storage, 'Lead');
  await manager.send(lead.id, 'go');
  const emit = required(sinks.get(lead.id));
  emit({ type: 'worker', id: 'tool-1', title: 'Research', status: 'running' });
  emit({
    type: 'worker',
    id: 'tool-1',
    inner: { type: 'delta', id: 'w', text: 'inside', role: 'thinking' },
  });
  const worker = required(manager.sessions.find((item) => item.observed));
  assert.equal(worker.messages[0].role, 'thinking');
  assert.equal(
    lead.messages.some((message) => message.text === 'inside'),
    false,
  );
  assert.equal(worker.title, 'Research');
  assert.equal(worker.delegated, undefined);
  await manager.dispose();
});

test('an idle window closing does not overwrite threads another window saved', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-sessions-'));
  const file = path.join(storage, 'sessions.json');
  await writeFile(file, JSON.stringify({ version: 1, sessions: [] }));
  const idle = new Sessions(storage, () => {
    throw new Error('An idle window starts no agents.');
  });
  await idle.load();
  const newer = JSON.stringify({ version: 1, sessions: [], savedBy: 'another window' });
  await writeFile(file, newer);
  await idle.dispose();
  assert.equal(await readFile(file, 'utf8'), newer);

  // A real change is still saved.
  const active = new Sessions(storage, () => ({
    send: async () => {},
    interrupt: async () => {},
    dispose() {},
  }));
  await active.load();
  active.create('codex', storage, storage, 'New');
  await active.dispose();
  assert.match(await readFile(file, 'utf8'), /"title":"New"/);
});

test('building a plan answers the pending request or starts a turn, and claims nothing else', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-sessions-'));
  const sent: string[] = [];
  const emitters = new Map<string, EventSink>();
  const manager = new Sessions(storage, (session, emit) => {
    emitters.set(session.id, emit);
    return {
      send: async (text) => {
        sent.push(text);
      },
      interrupt: async () => {},
      dispose() {},
    };
  });
  const claude = manager.create('claude', storage, storage, 'One');
  manager.setMode(claude.id, 'plan');
  await manager.send(claude.id, 'Plan it');
  const emit = required(emitters.get(claude.id));
  emit({ type: 'plan', text: '# Plan', final: true });
  const answers: boolean[] = [];
  emit({
    type: 'approval',
    approval: { id: 'p1', title: 'Build this plan?', detail: '', kind: 'plan' },
    respond: (allowed) => answers.push(allowed),
  });
  await manager.buildPlan(claude.id);
  assert.deepEqual(answers, [true]);
  assert.equal(claude.mode, 'agent');
  assert.equal(required(claude.plan).status, 'approved');
  assert.equal(sent.length, 1, 'an answered request does not send another message');
  assert.ok(sent[0].startsWith('Plan it'));
  assert.match(sent[0], /planning-guide/);
  assert.equal(claude.status, 'running', 'approval is not completion');

  // With no request waiting, as with Codex, building is an ordinary next turn.
  const codex = manager.create('codex', storage, storage, 'Two');
  manager.setMode(codex.id, 'plan');
  await manager.send(codex.id, 'Plan it too');
  const codexEmit = required(emitters.get(codex.id));
  codexEmit({ type: 'plan', text: 'Part', final: false });
  codexEmit({ type: 'plan', text: ' two', final: false });
  assert.deepEqual(
    [required(codex.plan).text, required(codex.plan).status],
    ['Part two', 'drafting'],
  );
  await assert.rejects(manager.buildPlan(codex.id), /Wait for this turn/);
  codexEmit({ type: 'status', status: 'interrupted' });
  assert.equal(required(codex.plan).status, 'incomplete', 'an unfinished plan says so');
  await manager.buildPlan(codex.id);
  assert.equal(sent.at(-1), 'Implement the plan.');
  await manager.dispose();
});

test('context reaches the agent but stays out of the transcript', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-sessions-'));
  const sent: unknown[][] = [];
  const manager = new Sessions(storage, () => ({
    send: async (...args) => {
      sent.push(args);
    },
    interrupt: async () => {},
    dispose() {},
  }));
  const session = manager.create('codex', storage, storage, 'One');
  const images = [{ path: '/a.png', mediaType: 'image/png' }];
  const attachments = [{ kind: 'file' as const, path: 'a.ts' }];
  await manager.send(session.id, 'Look', { context: '<attached_context/>', images, attachments });
  assert.deepEqual(sent[0], ['Look\n\n<attached_context/>', images, undefined]);
  assert.equal(session.messages[0].text, 'Look');
  assert.deepEqual(session.messages[0].attachments, attachments);
  await manager.dispose();
});
