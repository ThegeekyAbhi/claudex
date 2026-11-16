import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, Session } from '../../../../../src/shared/model';
import { applyEvent } from '../../../../../src/shared/protocol/events';
import {
  planPlacement,
  segment,
} from '../../../../../src/webview/features/conversation/view-model';

const rows = (...ids: string[]): Message[] =>
  ids.map((id, index) => ({ id, role: 'assistant', text: id, startedAt: index * 10 }));
function thread(messages: Message[]): Session {
  return {
    id: 't',
    provider: 'claude',
    title: 'T',
    cwd: '/x',
    workspace: '/x',
    status: 'running',
    messages,
    createdAt: 0,
    updatedAt: 0,
  };
}

test('a plan keeps its place while it streams and skips hidden rows', () => {
  const session = thread([
    ...rows('a', 'b'),
    {
      id: 'observed',
      role: 'tool',
      text: '',
      tool: { kind: 'edit', name: 'x', title: 'x', status: 'completed', diffSource: 'filesystem' },
    },
  ]);
  applyEvent(session, { type: 'plan', text: 'Part', final: false });
  assert.equal(session.plan?.after, 'b');
  session.messages.push(...rows('c'));
  applyEvent(session, { type: 'plan', text: 'Part two', final: true });
  assert.equal(session.plan?.after, 'b');
  assert.equal(session.plan?.text, 'Part two');
  // A later, separate plan takes a new place.
  applyEvent(session, { type: 'plan', text: 'New', final: true });
  assert.equal(session.plan?.after, 'c');
});

test('a finished plan is never pinned to the bottom of later turns', () => {
  const messages = rows('a', 'b', 'c', 'd');
  const plan = { text: 'p', status: 'approved' as const, updatedAt: 15, after: 'b' };
  assert.equal(planPlacement(segment(messages), plan, messages), 1);
  // Its message scrolled out of the loaded window: the header shows it instead.
  assert.equal(planPlacement(segment(messages.slice(2)), plan, messages), 'hidden');
  // Saved without a place: placed by time.
  const old = { ...plan, after: undefined };
  assert.equal(planPlacement(segment(messages), old, messages), 1);
  // Still being written: it follows the newest turn.
  assert.equal(
    planPlacement(segment(messages.slice(2)), { ...plan, status: 'drafting' }, messages),
    'end',
  );
});

test('a plan waiting on you with no known place stays in view', () => {
  const messages: Message[] = [{ id: 'a', role: 'assistant', text: 'a' }];
  const plan = { text: 'p', status: 'ready' as const, updatedAt: 1 };
  assert.equal(planPlacement(segment(messages), plan, messages), 'end');
  assert.equal(
    planPlacement(segment(messages), { ...plan, status: 'approved' }, messages),
    'hidden',
  );
});
