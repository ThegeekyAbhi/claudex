import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkPlan(ctx: UiCheckContext): Promise<void> {
  // Uses the skills catalog and selected agent left by skills.
  const { page, snapshot, box, sentOf, update } = ctx;
  // A plan is pinned above the thread, with rich Markdown and an honest state.
  const planText = [
    '# Render cache',
    '> [!WARNING]\n> Old keys must not be reused.',
    '## Steps',
    '- [x] Read `src/compiler.ts`',
    '- [ ] Change the key',
    '| File | Lines |\n| --- | --- |\n| compiler.ts | 12 |',
    '## Code',
    '```ts\nconst cache = new Map<string, Plan>(); // keyed by id\n```',
    '## Tests',
    'Run the suite.',
    '## Rollout',
    ...Array.from({ length: 8 }, (_, index) => `${index + 1}. Release step ${index + 1}.`),
  ].join('\n\n');
  snapshot.sessions.push({
    id: 'planned',
    title: 'Plan the cache',
    provider: 'claude',
    cwd: '/Projects/studio',
    workspace: '/Projects/studio',
    status: 'waiting',
    mode: 'plan',
    createdAt: 9,
    updatedAt: Date.now(),
    plan: {
      text: planText,
      status: 'ready',
      updatedAt: Date.now(),
      file: '/plans/render_cache.plan.md',
    },
    approval: { id: 'plan-1', title: 'Build this plan?', detail: '', kind: 'plan' },
    messages: [
      {
        id: 'pu',
        role: 'user',
        text: 'Plan the cache',
        attachments: [
          { kind: 'file', path: 'src/compiler.ts' },
          { kind: 'image', file: 'sample.png', name: 'mock.png' },
        ],
      },
      {
        id: 'img',
        role: 'image',
        text: '',
        image: { status: 'ready', file: 'sample.png', prompt: 'A render cache diagram' },
      },
      { id: 'img2', role: 'image', text: '', image: { status: 'generating' } },
      {
        id: 'img3',
        role: 'image',
        text: '',
        image: { status: 'failed', failure: 'Codex reached its image generation limit.' },
      },
    ],
  } as unknown as (typeof snapshot.sessions)[number]);
  const planned = snapshot.sessions.at(-1) as any;
  planned.plan.status = 'incomplete';
  planned.status = 'interrupted';
  delete planned.approval;
  await update('planned');
  assert.equal(await page.getByRole('button', { name: /Yes, implement in Auto/ }).count(), 0);
  const beforeIncomplete = (await sentOf('buildPlan')).length;
  await page.keyboard.press('Control+Enter');
  assert.equal((await sentOf('buildPlan')).length, beforeIncomplete);
  await page.getByText('Continue planning in the message box.').waitFor();
  planned.plan.status = 'ready';
  planned.status = 'waiting';
  planned.approval = { id: 'plan-1', title: 'Build this plan?', detail: '', kind: 'plan' };
  await update('planned');
  const plan = page.getByRole('region', { name: 'Plan' });
  // The plan reads in place, as Markdown: headings, lists, code.
  await plan.getByRole('heading', { name: 'Render cache' }).waitFor();
  await plan.getByRole('heading', { name: 'Steps' }).waitFor();
  assert.ok(await plan.locator('.plan-body pre .tok').count(), 'its code is coloured');
  assert.equal(
    await page.getByRole('button', { name: 'Allow once' }).count(),
    0,
    'the card answers it',
  );
  // A long plan starts folded, and opens in place.
  const more = plan.getByRole('button', { name: 'Show full plan' });
  await more.waitFor();
  const hidden = await plan.getByText('Release step 8.').evaluate((element) => {
    const body = element.closest('.plan-body') as Element;
    return element.getBoundingClientRect().top > body.getBoundingClientRect().bottom;
  });
  assert.ok(hidden, 'the end of a long plan is folded away');
  await page.screenshot({ path: 'test-results/screenshots/plan-folded.png' });
  await more.click();
  await plan.getByText('Release step 8.').waitFor();
  await plan.getByRole('button', { name: 'Show less' }).waitFor();
  await plan.getByRole('button', { name: 'Open plan' }).click();
  assert.equal((await sentOf('viewPlan')).at(-1).id, 'planned');
  await plan.getByRole('button', { name: 'Edit plan' }).click();
  assert.equal((await sentOf('editPlan')).at(-1).id, 'planned');
  // Claude Code's choices, in its order.
  const answers = page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('list', { name: 'Your answer' })
    .getByRole('button');
  const labels = await answers.evaluateAll((items) =>
    items.map((item) => item.querySelector('span > span')?.textContent),
  );
  assert.deepEqual(labels, [
    'Yes, implement in Auto',
    'Yes, approve each edit',
    'Yes, in a new chat',
    'No, keep planning',
  ]);
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /Yes, implement in Auto/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  assert.deepEqual((await sentOf('buildPlan')).at(-1), { type: 'buildPlan', id: 'planned' });
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /Yes, approve each edit/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  assert.deepEqual((await sentOf('buildPlan')).at(-1), {
    type: 'buildPlan',
    id: 'planned',
    approvals: 'manual',
  });
  // Notes go with the plan, and are the feedback when you keep planning.
  const notes = page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('textbox', { name: 'Notes for Claude' });
  await notes.fill('Keep the old keys readable');
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /Yes, implement in Auto/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  assert.equal((await sentOf('buildPlan')).at(-1).notes, 'Keep the old keys readable');
  await page.screenshot({ path: 'test-results/screenshots/plan-options.png' });
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /No, keep planning/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  assert.deepEqual((await sentOf('keepPlanning')).at(-1), {
    type: 'keepPlanning',
    id: 'planned',
    feedback: 'Keep the old keys readable',
  });
  assert.equal(await notes.inputValue(), '', 'sent notes clear');
  // Without notes, keeping planning declines and Claude waits.
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /No, keep planning/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  assert.deepEqual((await sentOf('keepPlanning')).at(-1), { type: 'keepPlanning', id: 'planned' });
  // Number keys pick an option while the card has focus.
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /Yes, implement in Auto/ })
    .focus();
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  assert.equal((await sentOf('buildPlan')).at(-1).approvals, 'manual');
  // A new chat picks its agent and model first.
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /Yes, in a new chat/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: 'Start in Auto' })
    .click();
  assert.equal((await sentOf('buildPlan')).at(-1).agent, 'claude');
  await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('button', { name: /Yes, in a new chat/ })
    .click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  // Cmd+Enter builds with an empty composer. A message you're writing stays yours to send.
  const buildsBefore = (await sentOf('buildPlan')).length;
  await page.keyboard.press('Control+Enter');
  assert.equal((await sentOf('buildPlan')).length, buildsBefore + 1);
  // Typing while a plan waits is feedback on it, not a separate turn.
  await box.fill('Use a smaller cache');
  await page.keyboard.press('Control+Enter');
  assert.equal((await sentOf('buildPlan')).length, buildsBefore + 1);
  assert.deepEqual((await sentOf('keepPlanning')).at(-1), {
    type: 'keepPlanning',
    id: 'planned',
    feedback: 'Use a smaller cache',
  });
  assert.equal(await box.inputValue(), '');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/screenshots/plan.png' });
  // Codex offers what Codex has: no per-edit approval.
  planned.provider = 'codex';
  delete planned.approval;
  planned.status = 'completed';
  await update('planned');
  const codexLabels = await page
    .getByRole('group', { name: 'Plan choices' })
    .getByRole('list', { name: 'Your answer' })
    .locator('.plan-option')
    .evaluateAll((items) => items.map((item) => item.querySelector('span > span')?.textContent));
  assert.deepEqual(codexLabels, [
    'Yes, implement in Auto',
    'Yes, in a new chat',
    'No, keep planning',
  ]);
  // Nothing is waiting to decline, so keeping planning needs your notes.
  const keepsBefore = (await sentOf('keepPlanning')).length;
  await page.getByRole('button', { name: /No, keep planning/ }).click();
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  assert.equal((await sentOf('keepPlanning')).length, keepsBefore);
  await page.getByText('Add notes for Codex, then choose this again.').waitFor();
  planned.provider = 'claude';
  planned.status = 'waiting';
  planned.approval = { id: 'plan-1', title: 'Build this plan?', detail: '', kind: 'plan' };
  await update('planned');
}
