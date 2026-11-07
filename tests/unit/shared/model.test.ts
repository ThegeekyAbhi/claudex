import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AgentProfile,
  actionSchema,
  applyEvent,
  BUILTIN_PROFILES,
  deriveTitle,
  mentionedAgent,
  missingSkills,
  orderProfiles,
  parseMention,
  parseProfileSettings,
  parseRunAgent,
  persistableSession,
  profileIdFrom,
  restoreSessions,
  runAgentDescription,
  runAgentJsonSchema,
  type Session,
  type Skill,
  setProfiles,
  withMention,
} from '../../../src/shared/model';
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

const SECOND: AgentProfile = { id: 'claud2', label: 'Claude 2', provider: 'claude', legacy: true };
const WORK: AgentProfile = {
  id: 'claude-work',
  label: 'Work',
  provider: 'claude',
  homeDir: '~/.w',
};
function withProfiles(extra: AgentProfile[], run: () => void) {
  setProfiles([...BUILTIN_PROFILES, ...extra]);
  try {
    run();
  } finally {
    setProfiles(BUILTIN_PROFILES);
  }
}
test('the old second-Claude marker restores as a profile id and rejects malformed ids', () => {
  const target = { ...session(), provider: 'claude', claudeCommand: 'claud2' };
  const [restored] = restoreSessions({ version: 1, sessions: [target] });
  assert.equal(restored.profileId, 'claud2');
  assert.equal(restored.id, target.id);
  assert.equal(restored.nativeId, target.nativeId);
  assert.equal('claudeCommand' in restored, false);
  // Written back with the old marker too, so an older Claudex still runs it on the second account.
  assert.equal(persistableSession(restored).claudeCommand, 'claud2');
  const start = { type: 'start', text: 'go', draftKey: 'draft' };
  // Only agents that exist now: nobody without a second account can start one.
  assert.equal(actionSchema.safeParse({ ...start, agent: 'claud2' }).success, false);
  withProfiles([SECOND, WORK], () => {
    assert.equal(actionSchema.safeParse({ ...start, agent: 'claud2' }).success, true);
    assert.equal(actionSchema.safeParse({ ...start, agent: 'claude-work' }).success, true);
  });
  for (const agent of ['Arbitrary', '../x', '-x', 'a'.repeat(25), 'two words', 'gpt'])
    assert.equal(actionSchema.safeParse({ ...start, agent }).success, false, agent);
  assert.equal(restoreSessions({ version: 1, sessions: [session()] })[0].profileId, undefined);
  // A Codex thread never becomes the second Claude account.
  const codex = { ...session(), provider: 'codex', claudeCommand: 'claud2' };
  assert.equal(restoreSessions({ version: 1, sessions: [codex] })[0].profileId, undefined);
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
  withProfiles([SECOND], () => {
    assert.deepEqual(parseMention('@codex fix it\nnow'), { agent: 'codex', prompt: 'fix it\nnow' });
    assert.equal(parseMention('@claude2 go')?.agent, 'claud2');
    assert.equal(parseMention('@claud2 go')?.agent, 'claud2');
    assert.equal(parseMention('@CLAUDE go')?.agent, 'claude');
    assert.equal(parseMention('please ask @codex'), undefined);
    assert.equal(parseMention('@codex'), undefined);
    assert.equal(parseMention('@someone do it'), undefined);
    assert.equal(mentionedAgent('@claude2 '), 'claud2');
    assert.equal(mentionedAgent('  @CODEX fix it'), 'codex');
    assert.equal(mentionedAgent('@claude'), undefined, 'the name may still be being typed');
    assert.equal(mentionedAgent('please ask @codex now'), undefined);
  });
});
test('mentions follow the profiles that exist, not a fixed list', () => {
  // Nobody without a second account can mention one.
  assert.equal(parseMention('@claude2 go'), undefined);
  assert.equal(parseMention('@claude-work go'), undefined);
  withProfiles([WORK], () => {
    assert.equal(parseMention('@claude-work review it')?.agent, 'claude-work');
    assert.equal(parseMention('@claude review it')?.agent, 'claude');
    assert.equal(parseMention('@claude-workx go'), undefined);
    assert.equal(withMention('@claude-work hi', 16, 16, 'codex').text, '@codex hi');
  });
  // An id the user picked wins over the old alias.
  const mine: AgentProfile = { id: 'claude2', label: 'Mine', provider: 'claude' };
  withProfiles([SECOND, mine], () => assert.equal(parseMention('@claude2 go')?.agent, 'claude2'));
});
test('run_agent arguments are validated before anything can start', () => {
  withProfiles([SECOND], () => {
    assert.equal(parseRunAgent({ agent: 'claude2', prompt: 'go' }).agent, 'claud2');
    assert.throws(() => parseRunAgent({ agent: 'bash', prompt: 'rm -rf /' }));
    assert.throws(() => parseRunAgent({ agent: 'codex', prompt: '   ' }));
  });
  // Only installed, runnable profiles can be asked for.
  assert.throws(() => parseRunAgent({ agent: 'claude2', prompt: 'go' }));
  const broken: AgentProfile = { ...WORK, status: 'missingFolder', problem: 'gone' };
  withProfiles([broken], () => {
    assert.throws(() => parseRunAgent({ agent: 'claude-work', prompt: 'go' }), /No runnable agent/);
    assert.deepEqual(runAgentJsonSchema().properties.agent.enum, ['claude', 'codex']);
  });
  withProfiles([WORK], () => {
    assert.deepEqual(runAgentJsonSchema().properties.agent.enum, [
      'claude-work',
      'claude',
      'codex',
    ]);
    assert.match(runAgentDescription(), /claude-work \(Work\)/);
  });
});
test('the profiles setting skips bad entries and names them', () => {
  const { profiles, problems } = parseProfileSettings([
    { id: 'claude-work', name: 'Work', provider: 'claude', configDir: '~/.claude-work' },
    { id: 'codex-client', name: 'Client', provider: 'codex', configDir: '~/.codex-client' },
    { id: 'claude', name: 'Mine', provider: 'claude' },
    { id: 'claude-work', name: 'Again', provider: 'claude' },
    { id: 'Bad Id', name: 'x', provider: 'claude' },
    { id: 'gem', name: 'Gem', provider: 'gemini' },
    'nonsense',
  ]);
  assert.deepEqual(
    profiles.map((profile) => [profile.id, profile.provider, profile.homeDir]),
    [
      ['claude-work', 'claude', '~/.claude-work'],
      ['codex-client', 'codex', '~/.codex-client'],
    ],
  );
  assert.equal(problems.length, 5);
  assert.match(problems[0], /built-in/);
  assert.match(problems[1], /twice/);
  assert.deepEqual(parseProfileSettings(undefined), { profiles: [], problems: [] });
  assert.equal(parseProfileSettings({}).problems.length, 1);
  assert.deepEqual(
    orderProfiles([...BUILTIN_PROFILES, profiles[1], profiles[0]]).map((profile) => profile.id),
    ['claude', 'claude-work', 'codex', 'codex-client'],
  );
  assert.equal(profileIdFrom('Claude – Work!', ['claude']), 'claude-work');
  assert.equal(profileIdFrom('Claude Work', ['claude-work']), 'claude-work-2');
  assert.equal(profileIdFrom('123', []), 'agent');
});
test('missing skills compare what each profile listed, ignoring project skills', () => {
  const skill = (name: string, source?: Skill['source']) => ({
    name,
    description: '',
    enabled: true,
    ...(source ? { source } : {}),
  });
  const main = {
    status: 'ready' as const,
    problems: [],
    skills: [
      skill('review', 'personal'),
      skill('deploy', 'project'),
      skill('pdf', 'plugin'),
      skill('x'),
    ],
  };
  const second = { status: 'ready' as const, problems: [], skills: [skill('x')] };
  assert.deepEqual(
    missingSkills(main, second).map((item) => item.name),
    ['review', 'pdf'],
  );
  assert.deepEqual(missingSkills(main, { ...second, status: 'loading' }), []);
});
test('model choices are validated as data', () => {
  const ok = { type: 'setModel', id: 'one', model: 'gpt-6.1-sol', effort: null };
  assert.equal(actionSchema.safeParse(ok).success, true);
  assert.equal(actionSchema.safeParse({ ...ok, model: 3 }).success, false);
});
