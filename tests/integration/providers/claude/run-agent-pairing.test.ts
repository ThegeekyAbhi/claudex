import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeAgent } from '../../../../src/providers/claude/adapter';
import type { Session } from '../../../../src/shared/model';

const session: Session = {
  id: 'lead',
  provider: 'claude',
  title: 'Lead',
  titleSource: 'prompt',
  cwd: '/project',
  workspace: '/project',
  status: 'running',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
};
/** The pairing state is private; these reach it the way the stream and approvals would. */
function agent() {
  const instance = new ClaudeAgent(session, 'claude', () => {}) as any;
  return {
    queued: (...ids: string[]) => instance.pendingRunAgent.push(...ids),
    decline: (id: string) => {
      instance.declined.add(id);
      instance.pendingRunAgent = instance.pendingRunAgent.filter((item: string) => item !== id);
    },
    take: (extra?: unknown) => instance.takeRunAgentId(extra) as string | undefined,
    pending: () => [...instance.pendingRunAgent] as string[],
  };
}

test('a declined run_agent call does not shift the next approved call onto its row', () => {
  const lead = agent();
  lead.queued('call-1', 'call-2');
  lead.decline('call-1');
  assert.equal(lead.take(), 'call-2');
  assert.deepEqual(lead.pending(), []);
});

test("the call's own tool-use id wins over queue order when the CLI passes it", () => {
  const lead = agent();
  lead.queued('call-1', 'call-2');
  assert.equal(lead.take({ _meta: { 'claudecode/toolUseId': 'call-2' } }), 'call-2');
  assert.equal(lead.take(), 'call-1');
});

test('an id from the CLI that matches no waiting call claims no row, not a guessed one', () => {
  const lead = agent();
  lead.queued('call-1');
  assert.equal(lead.take({ _meta: { 'claudecode/toolUseId': 'other' } }), undefined);
  // The waiting call keeps its own row for its own handler.
  assert.equal(lead.take(), 'call-1');
});
