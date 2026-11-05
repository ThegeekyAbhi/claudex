import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionSchema,
  applyEvent,
  deriveTitle,
  mentionedAgent,
  parseMention,
  parseRunAgent,
  restoreSessions,
  type Session,
  withMention,
} from '../src/core/model';
export function session(id = 'one'): Session {
  return {
    id,
    provider: 'codex',
    title: 'Test',
    cwd: '/tmp',
    workspace: '/tmp',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
test('stream deltas reconcile with final messages without duplicating text', () => {
  const target = session();
  applyEvent(target, { type: 'delta', id: 'answer', text: 'Hello' });
  applyEvent(target, { type: 'delta', id: 'answer', text: ' world' });
  applyEvent(target, {
    type: 'message',
    message: { id: 'answer', role: 'assistant', text: 'Hello world!' },
  });
  assert.equal(target.messages.length, 1);
  assert.equal(target.messages[0].text, 'Hello world!');
});
test('restore interrupts unfinished turns and drops obsolete approvals', () => {
  const target = session();
  target.status = 'waiting';
  target.approval = { id: 'old', title: 'Run?', detail: '' };
  const [restored] = restoreSessions({ version: 1, sessions: [target] });
  assert.equal(restored.status, 'interrupted');
  assert.equal(restored.approval, undefined);
});
test('rejects invalid saved formats and untrusted webview payload shapes', () => {
  assert.throws(() => restoreSessions({ version: 2, sessions: [] }));
  assert.equal(actionSchema.safeParse({ type: 'send', id: 'one', text: '   ' }).success, false);
  assert.equal(actionSchema.safeParse({ type: 'execute', command: 'arbitrary' }).success, false);
  assert.equal(
    actionSchema.safeParse({ type: 'approve', id: 'one', requestId: 3, allowed: true }).success,
    false,
  );
});

test('Claude command choice survives restoration and rejects arbitrary launch choices', () => {
  const target = { ...session(), provider: 'claude', claudeCommand: 'claud2' };
  const [restored] = restoreSessions({ version: 1, sessions: [target] });
  assert.equal(restored.claudeCommand, 'claud2');
  const start = { type: 'start', text: 'go', draftKey: 'draft' };
  assert.equal(actionSchema.safeParse({ ...start, agent: 'claud2' }).success, true);
  assert.equal(actionSchema.safeParse({ ...start, agent: 'arbitrary' }).success, false);
  assert.equal(restoreSessions({ version: 1, sessions: [session()] })[0].claudeCommand, undefined);
});

test('restored tools cannot keep claiming to run', () => {
  const target = session();
  target.messages.push({
    id: 'tool',
    role: 'tool',
    text: '',
    tool: { kind: 'command', name: 'command', title: 'pnpm test', status: 'running' },
  });
  const [restored] = restoreSessions({ version: 1, sessions: [target] });
  assert.equal(restored.messages[0].tool?.status, 'interrupted');
});
test('a thinking block records when it ended, and patches merge tool state', () => {
  const target = session();
  applyEvent(target, { type: 'delta', id: 'think', role: 'thinking', text: 'Hmm' });
  assert.equal(target.messages[0].endedAt, undefined);
  applyEvent(target, { type: 'message', message: { id: 'think', role: 'thinking', text: 'Hmm.' } });
  assert.ok(target.messages[0].endedAt);
  applyEvent(target, {
    type: 'message',
    message: {
      id: 'tool',
      role: 'tool',
      text: '',
      tool: { kind: 'command', name: 'Bash', title: 'ls', status: 'running' },
    },
  });
  applyEvent(target, { type: 'patch', id: 'tool', text: 'a.txt', tool: { status: 'completed' } });
  assert.equal(target.messages[1].text, 'a.txt');
  assert.equal(target.messages[1].tool?.title, 'ls');
  assert.equal(target.messages[1].tool?.status, 'completed');
});
test('titles come from the first meaningful line and are bounded', () => {
  assert.equal(deriveTitle('\n  Fix   the login bug \nmore detail'), 'Fix the login bug');
  assert.equal(deriveTitle('   '), 'New thread');
  assert.ok(deriveTitle('x'.repeat(300)).length <= 60);
});
test('picking an agent mid-message moves it to the front and keeps your words', () => {
  const pick = (text: string, name: string) => {
    const start = text.indexOf('|');
    const clean = text.replace('|', '');
    const end = start + clean.slice(start).search(/\s|$/);
    return withMention(clean, start, end, name);
  };
  assert.deepEqual(pick('use |@cl', 'claude'), { text: '@claude use ', caret: 12 });
  assert.deepEqual(pick('|@cl', 'claude'), { text: '@claude ', caret: 8 });
  assert.deepEqual(pick('|@cl fix it', 'codex'), { text: '@codex fix it', caret: 7 });
  assert.deepEqual(pick('use |@cl it now', 'claude').text, '@claude use it now');
  assert.deepEqual(pick('@codex use |@cl', 'claude').text, '@claude use ');
  assert.equal(parseMention(pick('use |@cl it now', 'claude').text)?.agent, 'claude');
});
test('only a leading @mention with a task delegates', () => {
  assert.deepEqual(parseMention('@codex fix it\nnow'), { agent: 'codex', prompt: 'fix it\nnow' });
  assert.equal(parseMention('@claude2 go')?.agent, 'claud2');
  assert.equal(parseMention('@CLAUDE go')?.agent, 'claude');
  assert.equal(parseMention('please ask @codex'), undefined);
  assert.equal(parseMention('@codex'), undefined);
  assert.equal(parseMention('@someone do it'), undefined);
  assert.equal(mentionedAgent('@claude2 '), 'claud2');
  assert.equal(mentionedAgent('  @CODEX fix it'), 'codex');
  assert.equal(mentionedAgent('@claude'), undefined, 'the name may still be being typed');
  assert.equal(mentionedAgent('please ask @codex now'), undefined);
});
test('run_agent arguments are validated before anything can start', () => {
  assert.equal(parseRunAgent({ agent: 'claude2', prompt: 'go' }).agent, 'claud2');
  assert.throws(() => parseRunAgent({ agent: 'bash', prompt: 'rm -rf /' }));
  assert.throws(() => parseRunAgent({ agent: 'codex', prompt: '   ' }));
});
test('model choices are validated as data', () => {
  const ok = { type: 'setModel', id: 'one', model: 'gpt-6.1-sol', effort: null };
  assert.equal(actionSchema.safeParse(ok).success, true);
  assert.equal(actionSchema.safeParse({ ...ok, model: 3 }).success, false);
});
