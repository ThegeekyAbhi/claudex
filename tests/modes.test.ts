import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_MODES,
  type AgentEvent,
  CAPABILITIES,
  CODEX_OWN_SETTINGS,
  chooseNudge,
  modeView,
  newChatMode,
  nextMode,
  restoreSessions,
  type Session,
} from '../src/core/model';
import { ClaudeAgent, claudeModeOptions } from '../src/providers/claude/adapter';
import { codexTurnSettings } from '../src/providers/codex/adapter';

const native = {
  sandbox: { type: 'workspaceWrite', networkAccess: false },
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
};

test('an unset mode sends nothing, so the CLI keeps its own default', () => {
  assert.deepEqual(claudeModeOptions(undefined), {});
  assert.deepEqual(codexTurnSettings(undefined, native), {});
});

test('Claude modes map to its real permission modes', () => {
  assert.deepEqual(claudeModeOptions('ask'), {
    permissionMode: 'dontAsk',
    disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
  });
  assert.equal(claudeModeOptions('plan').permissionMode, 'plan');
  assert.equal(claudeModeOptions('auto').permissionMode, 'auto');
});

test('Codex Ask is read-only with no approvals, whatever the thread started with', () => {
  assert.deepEqual(codexTurnSettings('ask', native), {
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    approvalPolicy: 'never',
  });
});

test('leaving Ask restores the settings Codex started the thread with', () => {
  assert.deepEqual(codexTurnSettings('plan', native), {
    sandboxPolicy: native.sandbox,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  });
});

test('Codex Auto keeps the sandbox and only changes who reviews', () => {
  assert.deepEqual(codexTurnSettings('auto', native), {
    sandboxPolicy: native.sandbox,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  });
});

test('Codex Auto without an on-request policy keeps you as the reviewer and your policy', () => {
  assert.deepEqual(codexTurnSettings('auto', { ...native, approvalPolicy: 'never' }), {
    sandboxPolicy: native.sandbox,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  });
  assert.equal(modeView('auto', CODEX_OWN_SETTINGS).label, 'Your Codex settings');
  assert.equal(modeView('auto', CODEX_OWN_SETTINGS).mode, undefined);
  const session = fakeSession({ mode: 'auto', reportedMode: CODEX_OWN_SETTINGS });
  assert.equal(chooseNudge(session, 'codex', 'auto', []), undefined);
});

test('the modes are Ask, Plan and Auto, and an old saved choice starts a new chat in Auto', () => {
  assert.deepEqual([...AGENT_MODES], ['ask', 'plan', 'auto']);
  assert.equal(nextMode(undefined), 'auto');
  assert.equal(nextMode('auto'), 'ask');
  assert.equal(nextMode('ask'), 'plan');
  assert.equal(nextMode('plan'), 'auto');
  assert.equal(newChatMode(undefined), 'auto');
  assert.equal(newChatMode('agent'), 'auto');
  assert.equal(newChatMode('plan'), 'plan');
});

test('no mode ever asks for a bypass or full access', () => {
  for (const mode of AGENT_MODES) {
    assert.notEqual(claudeModeOptions(mode).permissionMode, 'bypassPermissions');
    assert.doesNotMatch(JSON.stringify(codexTurnSettings(mode)), /dangerFullAccess/);
  }
});

test('the chip believes what the CLI reported over what was requested', () => {
  assert.equal(modeView(undefined, undefined).label, 'Default');
  assert.equal(modeView('auto', undefined).label, 'Auto');
  assert.equal(modeView('auto', 'default').label, 'Manual');
  assert.equal(modeView(undefined, 'auto').label, 'Auto');
  assert.equal(modeView(undefined, 'bypassPermissions').label, 'Bypass');
  assert.equal(modeView(undefined, 'bypassPermissions').mode, undefined);
  // Your own dontAsk still has edit tools, so it isn't called Ask.
  assert.equal(modeView('ask', 'dontAsk').label, 'Ask');
  assert.equal(modeView(undefined, 'dontAsk').label, 'Don’t ask');
});

test('Shift+Tab visits every mode and comes back', () => {
  const seen = [];
  let mode = nextMode(undefined);
  for (const _ of AGENT_MODES) {
    seen.push(mode);
    mode = nextMode(mode);
  }
  assert.deepEqual([...seen].sort(), [...AGENT_MODES].sort());
  assert.equal(mode, seen[0]);
});

test('every provider describes every mode', () => {
  for (const capabilities of Object.values(CAPABILITIES))
    for (const mode of AGENT_MODES) assert.ok(capabilities.modes[mode]);
});

function initOf(permissionMode: string) {
  return { type: 'system', subtype: 'init', session_id: 'native', model: 'm', permissionMode };
}
async function claudeTurn(mode: Session['mode'], reported: string) {
  const session = {
    id: 's',
    provider: 'claude',
    title: 't',
    cwd: '/tmp',
    workspace: '/tmp',
    mode,
    status: 'running',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  } as Session;
  const events: AgentEvent[] = [];
  const options: Record<string, unknown>[] = [];
  const agent = new ClaudeAgent(session, 'claude', (event) => events.push(event), {
    delegate: async () => ({ sessionId: 'c', status: 'completed', text: '' }),
    query: ((params: { options: Record<string, unknown> }) => {
      options.push(params.options);
      const stream = (async function* () {
        yield initOf(reported);
        yield { type: 'result', subtype: 'success', session_id: 'native', is_error: false };
      })();
      return Object.assign(stream, { close() {} });
    }) as never,
  });
  await agent.send('hello');
  return { events, options: options[0] ?? {} };
}

test('Claude reports the mode it is really in, and says so when a request was refused', async () => {
  const refused = await claudeTurn('auto', 'default');
  assert.equal(refused.options.permissionMode, 'auto');
  assert.ok(refused.events.some((e) => e.type === 'reportedMode' && e.mode === 'default'));
  const notice = refused.events.find((e) => e.type === 'message' && e.message.role === 'notice');
  assert.match(JSON.stringify(notice), /Auto isn’t available here, so Claude is running in Manual/);

  const honored = await claudeTurn('auto', 'auto');
  assert.ok(!honored.events.some((e) => e.type === 'message' && e.message.role === 'notice'));
});

test('an unset Claude mode reports the CLI default with no notice', async () => {
  const { events, options } = await claudeTurn(undefined, 'auto');
  assert.equal(options.permissionMode, undefined);
  assert.ok(events.some((e) => e.type === 'reportedMode' && e.mode === 'auto'));
  assert.ok(!events.some((e) => e.type === 'message' && e.message.role === 'notice'));
});

test('Claude in Ask cannot start other agents', async () => {
  const ask = await claudeTurn('ask', 'dontAsk');
  assert.equal(ask.options.mcpServers, undefined);
  assert.deepEqual(ask.options.disallowedTools, ['Edit', 'Write', 'NotebookEdit']);
  assert.ok((await claudeTurn('auto', 'auto')).options.mcpServers);
});

function fakeSession(extra: Partial<Session>): Session {
  return {
    id: 's',
    provider: 'claude',
    title: 't',
    cwd: '/tmp',
    workspace: '/tmp',
    status: 'completed',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as Session;
}

test('a new thread may suggest Plan once, and a closed nudge stays closed', () => {
  assert.equal(chooseNudge(undefined, 'codex', undefined, [])?.kind, 'plan');
  assert.equal(chooseNudge(undefined, 'codex', 'auto', [])?.kind, 'plan');
  assert.equal(chooseNudge(undefined, 'codex', 'ask', []), undefined);
  assert.equal(chooseNudge(undefined, 'codex', undefined, ['try-plan']), undefined);
  assert.equal(chooseNudge(fakeSession({}), 'claude', undefined, []), undefined);
});

test('being near a limit outranks a refused mode, and only one nudge shows', () => {
  const session = fakeSession({
    mode: 'auto',
    reportedMode: 'default',
    usage: { context: { used: 90, max: 100 }, updatedAt: 0 },
  });
  const first = chooseNudge(session, 'claude', 'auto', []);
  assert.equal(first?.kind, 'handoff');
  const second = chooseNudge(session, 'claude', 'auto', [first?.key ?? '']);
  assert.equal(second?.kind, 'mode');
  assert.match(second?.text ?? '', /running in Manual, not Auto/);
  assert.equal(
    chooseNudge(session, 'claude', 'auto', [first?.key ?? '', second?.key ?? '']),
    undefined,
  );
});

test('an honored mode and a limit that has reset say nothing', () => {
  const session = fakeSession({
    mode: 'auto',
    reportedMode: 'auto',
    usage: {
      limits: [{ id: 'w', label: 'Weekly', usedPercent: 99, resetsAt: Date.now() - 1000 }],
      updatedAt: 0,
    },
  });
  assert.equal(chooseNudge(session, 'claude', 'auto', []), undefined);
});

test('Claude reports its MCP servers, leaving out our own', async () => {
  const session = fakeSession({ status: 'running' });
  const events: AgentEvent[] = [];
  const agent = new ClaudeAgent(session, 'claude', (event) => events.push(event), {
    query: (() => {
      const stream = (async function* () {
        yield {
          ...initOf('default'),
          mcp_servers: [
            { name: 'agent-workspace', status: 'connected' },
            { name: 'figma', status: 'failed' },
          ],
        };
        yield { type: 'result', subtype: 'success', session_id: 'native', is_error: false };
      })();
      return Object.assign(stream, { close() {} });
    }) as never,
  });
  await agent.send('hello');
  const runtime = events.find((event) => event.type === 'runtime');
  assert.deepEqual(runtime, {
    type: 'runtime',
    runtime: { mcpServers: [{ name: 'figma', status: 'failed' }] },
  });
});

test('a thread saved in the old Agent mode survives with its ID and no mode', () => {
  const base = {
    title: 'Old',
    provider: 'claude',
    cwd: '/project',
    workspace: '/project',
    status: 'completed',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  };
  const [legacy, unset] = restoreSessions({
    version: 1,
    sessions: [
      { ...base, id: 'legacy', mode: 'agent' },
      { ...base, id: 'unset' },
    ],
  });
  assert.equal(legacy?.id, 'legacy');
  assert.equal(legacy?.mode, undefined);
  assert.equal(unset?.id, 'unset');
});
