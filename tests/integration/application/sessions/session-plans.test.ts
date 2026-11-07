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
