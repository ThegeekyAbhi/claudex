import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionPlans } from '../../../../src/application/sessions/session-plans';
import { canBuildPlan, type Session } from '../../../../src/shared/model';

function fixture() {
  const session: Session = {
    id: 'one',
    title: 'Plan',
    provider: 'codex',
    cwd: '/tmp',
    workspace: '/tmp',
    status: 'completed',
    mode: 'plan',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    plan: { text: '# Finished plan', status: 'ready', updatedAt: 1 },
  };
  let read: () => Promise<string> = async () => session.plan?.text ?? '';
  let sends = 0;
  const plans = new SessionPlans({
    assertAvailable() {},
    get: () => session,
    changed() {},
    keepPlanning() {},
    approve() {},
    currentPlanText: () => read(),
    send: async () => {
      sends++;
      session.status = 'running';
    },
  });
  return {
    session,
    plans,
    sends: () => sends,
    read: (next: typeof read) => {
      read = next;
    },
  };
}

test('implementation requires a nonempty finished plan and a thread ready for it', async () => {
  const { session, plans, sends } = fixture();
  for (const status of ['drafting', 'incomplete', 'approved'] as const) {
    if (session.plan) session.plan.status = status;
    assert.equal(canBuildPlan(session), false);
    await assert.rejects(plans.buildPlan(session.id), /finished plan/);
    await assert.rejects(plans.handOffPlan(session.id), /finished plan/);
  }
  if (session.plan) {
    session.plan.status = 'ready';
    session.plan.text = '  ';
  }
  assert.equal(canBuildPlan(session), false);
  await assert.rejects(plans.buildPlan(session.id), /finished plan/);
  delete session.plan;
  await assert.rejects(plans.buildPlan(session.id), /no plan/);
  assert.equal(sends(), 0);
});

test('a plan changed during the file read cannot be implemented', async () => {
  const { session, plans, read, sends } = fixture();
  read(async () => {
    session.plan = { text: '# Revision in progress', status: 'drafting', updatedAt: 2 };
    return '# Old plan';
  });
  await assert.rejects(plans.buildPlan(session.id), /plan changed/);
  assert.equal(sends(), 0);
  assert.equal(session.mode, 'plan');
});

test('duplicate implementation requests during the file read start only one turn', async () => {
  const { session, plans, read, sends } = fixture();
  let release = (_text: string) => {};
  read(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = plans.buildPlan(session.id);
  await assert.rejects(plans.buildPlan(session.id), /already being requested/);
  release('# Finished plan');
  await first;
  assert.equal(sends(), 1);
  assert.equal(session.plan?.status, 'approved');
});

test('stopping or failing while reading a plan is rechecked before implementation', async () => {
  const { session, plans, read, sends } = fixture();
  session.status = 'waiting';
  session.approval = { id: 'approval', kind: 'plan', title: 'Implement?', detail: '' };
  read(async () => {
    session.status = 'running';
    delete session.approval;
    return '# Finished plan';
  });
  await assert.rejects(plans.buildPlan(session.id), /Wait for this turn/);
  assert.equal(sends(), 0);
});

function answering(provider: 'claude' | 'codex', waiting: boolean) {
  const session: Session = {
    id: 'two',
    title: 'Plan',
    provider,
    cwd: '/tmp',
    workspace: '/tmp',
    status: waiting ? 'waiting' : 'completed',
    mode: 'plan',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    plan: { text: '# Plan\n\nDo it.', status: 'ready', updatedAt: 1 },
    ...(waiting
      ? { approval: { id: 'req', title: 'Build this plan?', detail: '', kind: 'plan' as const } }
      : {}),
  };
  const approvals: { allowed: boolean; answers: Record<string, string> }[] = [];
  const sent: string[] = [];
  const plans = new SessionPlans({
    assertAvailable() {},
    get: () => session,
    changed() {},
    keepPlanning() {},
    approve: (_id, _request, allowed, answers) => approvals.push({ allowed, answers }),
    currentPlanText: async () => session.plan?.text ?? '',
    send: async (_id, text) => {
      sent.push(text);
    },
  });
  return { session, plans, approvals, sent };
}

test('approving each edit leaves the mode to the CLI’s own default', async () => {
  const { session, plans, approvals } = answering('claude', true);
  await plans.buildPlan(session.id, { approvals: 'manual' });
  assert.equal(session.mode, undefined);
  assert.equal(session.plan?.status, 'approved');
  assert.deepEqual(approvals, [{ allowed: true, answers: {} }]);
});

test('Auto stays the default way to build', async () => {
  const { session, plans } = answering('claude', true);
  await plans.buildPlan(session.id);
  assert.equal(session.mode, 'auto');
});

test('your notes go with the plan you approve', async () => {
  const claude = answering('claude', true);
  await claude.plans.buildPlan(claude.session.id, { notes: 'Keep old keys readable' });
  const plan = claude.approvals[0]?.answers.plan ?? '';
  assert.match(plan, /^# Plan\n\nDo it\.\n\n## Notes from you\n\nKeep old keys readable\n$/);
  const codex = answering('codex', false);
  await codex.plans.buildPlan(codex.session.id, { notes: 'Keep old keys readable' });
  assert.match(
    codex.sent[0] ?? '',
    /I edited it:[\s\S]*## Notes from you\n\nKeep old keys readable/,
  );
  const fresh = answering('claude', false);
  assert.match(
    await fresh.plans.handOffPlan(fresh.session.id, 'Use the new API'),
    /^Implement this plan:[\s\S]*## Notes from you\n\nUse the new API/,
  );
  // Blank notes change nothing, so an unedited plan isn't pasted back.
  const blank = answering('claude', true);
  await blank.plans.buildPlan(blank.session.id, { notes: '   ' });
  assert.deepEqual(blank.approvals[0]?.answers, {});
});

test('a build that fails to start restores the mode you had', async () => {
  const { session, plans } = answering('codex', false);
  (plans as unknown as { deps: { send: () => Promise<void> } }).deps.send = async () => {
    throw new Error('offline');
  };
  await assert.rejects(plans.buildPlan(session.id, { approvals: 'manual' }), /offline/);
  assert.equal(session.mode, 'plan');
  assert.equal(session.plan?.status, 'ready');
});

test('a build whose turn starts and then fails keeps your approval', async () => {
  // A usage limit ends the turn, but "Implement the plan." already reached the CLI.
  const { session, plans } = answering('claude', false);
  (plans as unknown as { deps: { send: () => Promise<void> } }).deps.send = async () => {
    session.messages.push(
      { id: 'u', role: 'user', text: 'Implement the plan.' },
      { id: 'a', role: 'assistant', text: "You've hit your 5-hour limit · resets 2:10am" },
    );
    session.status = 'failed';
  };
  await plans.buildPlan(session.id);
  assert.equal(session.mode, 'auto');
  assert.equal(session.plan?.status, 'approved');
  assert.equal(canBuildPlan(session), false);
});
