import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, Session, ToolKind } from '../src/core/model';
import { mascotActivity } from '../src/webview/features/mascot/activity';

function session(fields: Partial<Session> = {}): Session {
  return {
    id: 'mascot-test',
    provider: 'codex',
    title: 'Activity',
    cwd: '/workspace',
    workspace: '/workspace',
    status: 'running',
    mode: 'auto',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  };
}
function tool(kind: ToolKind): Message {
  return {
    id: kind,
    role: 'tool',
    text: '',
    tool: { kind, name: kind, title: kind, status: 'running' },
  };
}

test('mascot follows observed activity before the broader plan mode', () => {
  assert.equal(mascotActivity(session()), 'working');
  assert.equal(mascotActivity(session({ mode: 'plan' })), 'planning');
  for (const kind of ['read', 'search', 'web'] as const)
    assert.equal(mascotActivity(session({ mode: 'plan', messages: [tool(kind)] })), 'reading');
  assert.equal(mascotActivity(session({ mode: 'plan', messages: [tool('edit')] })), 'coding');
  assert.equal(mascotActivity(session({ messages: [tool('command')] })), 'working');
  assert.equal(
    mascotActivity(session({ messages: [{ id: 'thought', role: 'thinking', text: '' }] })),
    'thinking',
  );
  assert.equal(
    mascotActivity(
      session({ messages: [{ id: 'thought', role: 'thinking', text: '', endedAt: 2 }] }),
    ),
    'working',
  );
});

test('old tools do not leak into a new turn and tool completion is not session completion', () => {
  assert.equal(
    mascotActivity(
      session({ messages: [tool('edit'), { id: 'new', role: 'user', text: 'Next' }] }),
    ),
    'working',
  );
  const done = tool('edit');
  if (done.tool) done.tool.status = 'completed';
  assert.equal(mascotActivity(session({ messages: [done] })), 'working');
});

test('waiting is static and terminal or stopping sessions do not loop', () => {
  assert.equal(
    mascotActivity(session({ status: 'waiting', messages: [tool('edit')] })),
    'attentive',
  );
  assert.equal(
    mascotActivity(session({ approval: { id: 'a', title: 'Approve?', detail: '' } })),
    'attentive',
  );
  for (const status of ['completed', 'failed', 'interrupted', 'idle'] as const)
    assert.equal(
      mascotActivity(
        session({
          status,
          messages: [tool('edit')],
          approval: { id: 'stale', title: '', detail: '' },
        }),
      ),
      undefined,
    );
  assert.equal(
    mascotActivity(session({ transition: 'stopping', messages: [tool('edit')] })),
    undefined,
  );
});
