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
  assert.equal(await page.getByRole('button', { name: /Implement in Auto/ }).count(), 0);
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
  // The plan bar docks on the message box: one primary way forward, the rest in its menu.
  const choices = page.getByRole('group', { name: 'Plan choices' });
  await choices.getByRole('button', { name: 'Review the plan' }).waitFor();
  assert.equal(
    await choices.getByRole('button', { name: 'Review the plan' }).textContent(),
    'Render cache',
    'the bar names the plan by its heading',
  );
  const openMenu = async () => {
    await choices.getByRole('button', { name: 'More ways to continue' }).click();
    return page.getByRole('menu');
  };
  // Claude Code's choices, in its order.
  const menu = await openMenu();
  const items = await menu
    .getByRole('menuitem')
    .evaluateAll((nodes) => nodes.map((node) => node.querySelector('span > span')?.textContent));
  assert.deepEqual(items, [
    'Implement in Auto',
    'Approve each edit',
    'In a new chat…',
    'Keep planning',
  ]);
  await page.screenshot({ path: 'test-results/screenshots/plan-menu.png' });
  await page.keyboard.press('Escape');
  await choices.getByRole('button', { name: 'Implement in Auto' }).click();
  assert.deepEqual((await sentOf('buildPlan')).at(-1), { type: 'buildPlan', id: 'planned' });
  // Choosing per-edit approval from the menu builds, and becomes the way offered first.
  await (await openMenu()).getByRole('menuitem', { name: /Approve each edit/ }).click();
  assert.deepEqual((await sentOf('buildPlan')).at(-1), {
    type: 'buildPlan',
    id: 'planned',
    approvals: 'manual',
  });
  await choices.getByRole('button', { name: 'Implement, approving edits' }).waitFor();
  await (await openMenu()).getByRole('menuitem', { name: /Implement in Auto/ }).click();
  await choices.getByRole('button', { name: 'Implement in Auto' }).waitFor();
  // The message box holds the notes: implementing sends them along and clears the box.
  await box.fill('Keep the old keys readable');
  await choices.getByText('+ notes').waitFor();
  await page.screenshot({ path: 'test-results/screenshots/plan-options.png' });
  await choices.getByRole('button', { name: 'Implement in Auto' }).click();
  assert.equal((await sentOf('buildPlan')).at(-1).notes, 'Keep the old keys readable');
  assert.equal(await box.inputValue(), '', 'notes sent with the build clear');
  // Keeping planning sends them back as feedback.
  await box.fill('Keep the old keys readable');
  await choices.getByRole('button', { name: 'Keep planning' }).click();
  assert.deepEqual((await sentOf('keepPlanning')).at(-1), {
    type: 'keepPlanning',
    id: 'planned',
    feedback: 'Keep the old keys readable',
  });
  assert.equal(await box.inputValue(), '', 'sent notes clear');
  // Without notes, keeping planning declines and Claude waits.
  await choices.getByRole('button', { name: 'Keep planning' }).click();
  assert.deepEqual((await sentOf('keepPlanning')).at(-1), { type: 'keepPlanning', id: 'planned' });
  // A new chat picks its agent and model first, in place, and Esc goes back.
  await (await openMenu()).getByRole('menuitem', { name: /In a new chat/ }).click();
  await choices.getByRole('button', { name: 'Start in Auto' }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/plan-new-chat.png' });
  await choices.getByRole('button', { name: 'Start in Auto' }).click();
  assert.equal((await sentOf('buildPlan')).at(-1).agent, 'claude');
  await page.keyboard.press('Escape');
  await choices.getByRole('button', { name: 'Implement in Auto' }).waitFor();
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
  // In a slim side bar the bar keeps to one row, without spilling sideways.
  await page.setViewportSize({ width: 380, height: 760 });
  await choices.getByRole('button', { name: 'Implement in Auto' }).waitFor();
  assert.ok(
    await page
      .locator('.plan-options')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    'the plan bar fits a narrow panel',
  );
  await page.screenshot({ path: 'test-results/screenshots/plan-narrow.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  // Codex offers what Codex has: no per-edit approval, and nothing waiting to decline.
  planned.provider = 'codex';
  delete planned.approval;
  planned.status = 'completed';
  await update('planned');
  const codexItems = await (await openMenu())
    .getByRole('menuitem')
    .evaluateAll((nodes) => nodes.map((node) => node.querySelector('span > span')?.textContent));
  assert.deepEqual(codexItems, ['Implement in Auto', 'In a new chat…']);
  await page.keyboard.press('Escape');
  assert.equal(await choices.getByRole('button', { name: 'Keep planning' }).count(), 0);
  planned.provider = 'claude';
  planned.status = 'waiting';
  planned.approval = { id: 'plan-1', title: 'Build this plan?', detail: '', kind: 'plan' };
  await update('planned');
}
