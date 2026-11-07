import assert from 'node:assert/strict';
import test from 'node:test';
import { isAgentPlanFile, planWithNotes } from '../../../../src/shared/model';

test('Claude Code’s own plan files are recognised, in any config folder', () => {
  assert.ok(isAgentPlanFile('/Users/me/.claude/plans/quiet-river.md'));
  assert.ok(isAgentPlanFile('/Users/me/.claude-account2/plans/alright-how-can-we.md'));
  assert.ok(isAgentPlanFile('C:\\Users\\me\\.claude\\plans\\quiet-river.md'));
  assert.equal(isAgentPlanFile('/work/app/docs/plans/rollout.md'), false, 'your own plans');
  assert.equal(isAgentPlanFile('/Users/me/.claude/plans/notes.txt'), false);
  assert.equal(isAgentPlanFile('/Users/me/.claude/settings.json'), false);
});

test('notes are added under their own heading, and blank notes add nothing', () => {
  assert.equal(
    planWithNotes('# Plan\n', 'Be careful'),
    '# Plan\n\n## Notes from you\n\nBe careful\n',
  );
  assert.equal(planWithNotes('# Plan', '  '), '# Plan');
  assert.equal(planWithNotes('# Plan'), '# Plan');
});
