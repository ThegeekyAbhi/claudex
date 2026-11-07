import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import {
  type ThreadControlContext,
  threadControlHandlers,
} from '../../../../src/extension/handlers/thread-control';
import { routeAction } from '../../../../src/extension/router';
import type { Surface } from '../../../../src/extension/surfaces';
import type { Session } from '../../../../src/shared/model';
import { testRoutes } from '../../../fixtures/host-route-fixture';

function fixture() {
  const session: Session = {
    id: 'thread',
    provider: 'codex',
    title: 'Task',
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const calls: unknown[] = [];
  const context: ThreadControlContext = {
    sessions: {
      get: (id) => {
        assert.equal(id, session.id);
        return session;
      },
      changed: () => {
        calls.push(['changed', session.pinned]);
      },
      interrupt: async (id) => {
        calls.push(['interrupt', id]);
      },
      approve: (...args) => {
        calls.push(['approve', ...args]);
      },
      allowInAuto: (...args) => {
        calls.push(['auto', ...args]);
      },
      setMode: (...args) => {
        calls.push(['mode', ...args]);
      },
    },
    terminals: new Map(),
  };
  const handlers = threadControlHandlers(context);
  const dispatch = (raw: unknown) =>
    routeAction(raw, {} as Surface, testRoutes({ workspace: handlers }));
  return { session, calls, context, dispatch };
}

test('thread pin handler mutates the existing session before notifying observers', async () => {
  const { session, calls, dispatch } = fixture();
  await dispatch({ type: 'pin', id: session.id, pinned: true });
  assert.equal(session.pinned, true);
  await dispatch({ type: 'pin', id: session.id, pinned: false });
  assert.equal(session.pinned, false);
  assert.deepEqual(calls, [
    ['changed', true],
    ['changed', false],
  ]);
});

test('thread approvals enter auto only for an allowed request and preserve answers', async () => {
  const { calls, dispatch } = fixture();
  await dispatch({ type: 'approve', id: 'thread', requestId: 'r1', auto: true, allowed: true });
  await dispatch({
    type: 'approve',
    id: 'thread',
    requestId: 'r2',
    auto: true,
    allowed: false,
    answers: { reason: 'stop' },
  });
  await dispatch({ type: 'approve', id: 'thread', requestId: 'r3', allowed: true });
  assert.deepEqual(calls, [
    ['auto', 'thread', 'r1'],
    ['approve', 'thread', 'r2', false, { reason: 'stop' }],
    ['approve', 'thread', 'r3', true, {}],
  ]);
});

test('thread interrupt shows the native terminal and rejects without interrupting rich chat', async () => {
  const { context, calls, dispatch } = fixture();
  context.terminals.set('thread', {
    terminal: {
      show: () => {
        calls.push('show');
      },
    } as vscode.Terminal,
    openedAt: 1,
  });
  await assert.rejects(dispatch({ type: 'interrupt', id: 'thread' }), {
    message: 'This session is in a native terminal. Use Ctrl+C there to stop it.',
  });
  assert.deepEqual(calls, ['show']);
});

test('thread controls forward rich chat interrupts and mode changes unchanged', async () => {
  const { calls, dispatch } = fixture();
  await dispatch({ type: 'interrupt', id: 'thread' });
  await dispatch({ type: 'setMode', id: 'thread', mode: 'auto' });
  assert.deepEqual(calls, [
    ['interrupt', 'thread'],
    ['mode', 'thread', 'auto'],
  ]);
});
