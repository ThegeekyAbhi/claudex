import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChangesResult } from '../../../../src/shared/model';
import type { HostMessage } from '../../../../src/webview/app/bridge';
import {
  type HostMessageTargets,
  receiveHostMessage,
} from '../../../../src/webview/app/host-messages';

function targets() {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return true;
    };
  const handlers: HostMessageTargets = {
    snapshot: {
      update: record('snapshot'),
      imageBase: record('imageBase'),
      context: record('context'),
    },
    drafts: {
      sent: record('draft.sent'),
      write: record('draft.write'),
      attach: record('draft.attach'),
    },
    turns: {
      snapshot: record('turn.snapshot'),
      sent: record('turn.sent'),
      failed: record('turn.failed'),
    },
    tabs: { snapshot: record('tabs.snapshot') },
    changes: { received: record('changes.received'), failed: record('changes.failed') },
    reportError: record('error'),
  };
  return { calls, handlers };
}

test('snapshot processing retains merge, image, submission, then selection update order', () => {
  const { calls, handlers } = targets();
  const message: Extract<HostMessage, { type: 'snapshot' }> = {
    type: 'snapshot',
    snapshot: { sessions: [], project: 'Project', trusted: true },
    imageBase: 'images/',
    selectedId: 'local-id',
  };
  receiveHostMessage(message, handlers);
  assert.deepEqual(calls, [
    ['snapshot', message.snapshot, undefined],
    ['imageBase', 'images/'],
    ['turn.snapshot'],
    ['tabs.snapshot', 'local-id'],
  ]);
});

test('empty image bases are ignored and absent selection is still delivered', () => {
  const { calls, handlers } = targets();
  receiveHostMessage(
    {
      type: 'snapshot',
      snapshot: { sessions: [], project: 'Project', trusted: true },
      imageBase: '',
    },
    handlers,
  );
  assert.deepEqual(calls, [
    ['snapshot', { sessions: [], project: 'Project', trusted: true }, undefined],
    ['turn.snapshot'],
    ['tabs.snapshot', undefined],
  ]);
});

test('sent acknowledgement clears the draft before releasing submission state', () => {
  const { calls, handlers } = targets();
  receiveHostMessage({ type: 'sent', id: 'local-id', text: '@claude review' }, handlers);
  assert.deepEqual(calls, [
    ['draft.sent', 'local-id', '@claude review', undefined, undefined],
    ['turn.sent', 'local-id', undefined],
  ]);
});

test('general errors remain visible without releasing unrelated pending operations', () => {
  const { calls, handlers } = targets();
  receiveHostMessage({ type: 'error', text: 'Interrupted' }, handlers);
  assert.deepEqual(calls, [['error', 'Interrupted']]);
});

test('drafts, attachments, context and changes reach only their owning concern', () => {
  const { calls, handlers } = targets();
  const attachment = { kind: 'file', path: 'src/app.ts' } as const;
  const context: Extract<HostMessage, { type: 'contextResults' }> = {
    type: 'contextResults',
    requestId: 2,
    matches: [],
    recent: [],
    terminals: [],
  };
  const result: ChangesResult = { files: [] };
  receiveHostMessage({ type: 'draft', id: 'local-id', text: 'Draft' }, handlers);
  receiveHostMessage({ type: 'attached', draftKey: 'draft:1', attachment }, handlers);
  receiveHostMessage(context, handlers);
  receiveHostMessage({ type: 'changes', id: 'local-id', result }, handlers);
  assert.deepEqual(calls, [
    ['draft.write', 'local-id', 'Draft'],
    ['draft.attach', 'draft:1', attachment],
    ['context', context],
    ['changes.received', 'local-id', result],
  ]);
});

test('validated operation failures reach only their owner with request identity', () => {
  const { calls, handlers } = targets();
  receiveHostMessage(
    {
      type: 'error',
      text: 'Send failed',
      operation: {
        kind: 'submission',
        submissionId: 'send-2',
        draftKey: 'thread',
      },
    },
    handlers,
  );
  receiveHostMessage(
    {
      type: 'error',
      text: 'Changes failed',
      operation: {
        kind: 'changes',
        requestId: 'change-2',
        id: 'thread',
      },
    },
    handlers,
  );
  assert.deepEqual(calls, [
    ['turn.failed', 'send-2', 'thread'],
    ['error', 'Send failed'],
    ['changes.failed', 'thread', 'change-2'],
    ['error', 'Changes failed'],
  ]);
});

test('superseded operation failures neither show errors nor release another owner', () => {
  const { calls, handlers } = targets();
  handlers.turns.failed = () => false;
  handlers.changes.failed = () => false;
  receiveHostMessage(
    {
      type: 'error',
      text: 'Old send',
      operation: {
        kind: 'submission',
        submissionId: 'old',
        draftKey: 'thread',
      },
    },
    handlers,
  );
  receiveHostMessage(
    {
      type: 'error',
      text: 'Old changes',
      operation: {
        kind: 'changes',
        requestId: 'old',
        id: 'thread',
      },
    },
    handlers,
  );
  assert.deepEqual(calls, []);
});
