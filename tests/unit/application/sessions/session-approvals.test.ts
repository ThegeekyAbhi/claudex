import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionApprovals } from '../../../../src/application/sessions/session-approvals';
import type { AgentEvent, Session } from '../../../../src/shared/model';

function session(): Session {
  return {
    id: 'local-session',
    provider: 'claude',
    title: 'A thread',
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function approvalsFixture(stop: () => Promise<void> = async () => {}) {
  const thread = session();
  const events: string[] = [];
  const approvals = new SessionApprovals({
    isDisposed: () => false,
    get: (id) => {
      assert.equal(id, thread.id);
      return thread;
    },
    changed: () => events.push('changed'),
    approve: (id, requestId, allowed, answers) =>
      approvals.approve(id, requestId, allowed, answers),
    flush: async () => {
      events.push('flush');
    },
    send: async () => {
      events.push('send');
    },
    stopTurn: () => {
      events.push('stop');
      return stop();
    },
  });
  return { thread, events, approvals };
}

test('approvals advance the queue before responding and notify only after the response', () => {
  const { thread, events, approvals } = approvalsFixture();
  const first: Extract<AgentEvent, { type: 'approval' }> = {
    type: 'approval',
    approval: { id: 'one', title: 'First', detail: '' },
    respond: (allowed, answers) => {
      assert.equal(allowed, false);
      assert.deepEqual(answers, { reason: 'skip' });
      assert.equal(thread.approval?.id, 'two');
      assert.equal(thread.status, 'waiting');
      events.push('respond');
    },
  };
  const second: typeof first = {
    type: 'approval',
    approval: { id: 'two', title: 'Second', detail: '' },
    respond: () => {
      assert.equal(thread.approval, undefined);
      assert.equal(thread.status, 'running');
      events.push('respond');
    },
  };
  approvals.record(thread.id, first);
  approvals.record(thread.id, second);
  approvals.approve(thread.id, 'one', false, { reason: 'skip' });
  approvals.approve(thread.id, 'two', true, {});
  assert.deepEqual(events, ['respond', 'changed', 'respond', 'changed']);
  assert.throws(() => approvals.approve(thread.id, 'one', true, {}), /no longer pending/);
});

test('approval transitions reject competing answers without consuming the pending request', async () => {
  let release = () => {};
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { thread, events, approvals } = approvalsFixture(() => stopped);
  const request: Extract<AgentEvent, { type: 'approval' }> = {
    type: 'approval',
    approval: { id: 'request', title: 'Tool', detail: '', origin: 'provider' },
    respond: () => events.push('respond'),
  };
  approvals.record(thread.id, request);
  thread.nativeId = 'native-existing';
  thread.status = 'waiting';
  const transition = approvals.resumeInAuto(thread.id, 'request');
  // Observe only the competing answer, after the transition's start notifications.
  events.length = 0;
  assert.throws(() => approvals.approve(thread.id, 'request', true, {}), /Auto transition/);
  assert.equal(approvals.pendingFor(thread.id), request.approval);
  assert.deepEqual(events, []);
  assert.equal(approvals.cancelTransition(thread.id), true);
  release();
  await transition;
  assert.equal(approvals.cancelTransition(thread.id), false);
  events.length = 0;
  thread.provider = 'codex';
  assert.throws(() => approvals.allowInAuto(thread.id, 'request'), /on-request/);
  thread.nativeSettings = { approvalPolicy: 'on-request' };
  thread.reportedMode = 'old mode';
  approvals.allowInAuto(thread.id, 'request');
  assert.equal(thread.mode, 'auto');
  assert.equal(thread.reportedMode, undefined);
  assert.deepEqual(events, ['respond', 'changed']);
});

test('pending approvals preserve insertion order, replace repeated IDs and clear in isolation', () => {
  const { thread, events, approvals } = approvalsFixture();
  const request = (id: string): Extract<AgentEvent, { type: 'approval' }> => ({
    type: 'approval',
    approval: { id, title: id, detail: '' },
    respond: () => events.push('respond'),
  });
  const first = request('first');
  const second = request('second');
  const replacement = request('first');
  const other = request('other');
  assert.equal(approvals.pendingFor(thread.id), undefined);
  approvals.record(thread.id, first);
  approvals.record(thread.id, second);
  approvals.record(thread.id, replacement);
  approvals.record('other-session', other);
  assert.equal(approvals.pendingFor(thread.id), replacement.approval);
  approvals.approve(thread.id, 'first', false, {});
  assert.equal(approvals.pendingFor(thread.id), second.approval);
  assert.deepEqual(events, ['respond', 'changed']);
  const before = { approval: thread.approval, status: thread.status };
  approvals.clear(thread.id);
  approvals.clear(thread.id);
  assert.equal(approvals.pendingFor(thread.id), undefined);
  assert.equal(approvals.pendingFor('other-session'), other.approval);
  assert.equal(thread.approval, before.approval);
  assert.equal(thread.status, before.status);
  assert.deepEqual(events, ['respond', 'changed'], 'clearing neither responds nor notifies');
  approvals.clearAll();
  assert.equal(approvals.pendingFor('other-session'), undefined);
  assert.throws(() => approvals.approve(thread.id, 'second', true, {}), /no longer pending/);
  assert.deepEqual(events, ['respond', 'changed']);
});
