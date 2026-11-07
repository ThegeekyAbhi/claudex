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
  assert.equal(await page.getByRole('button', { name: 'Implement plan', exact: true }).count(), 0);
  const beforeIncomplete = (await sentOf('buildPlan')).length;
  await page.keyboard.press('Control+Enter');
  assert.equal((await sentOf('buildPlan')).length, beforeIncomplete);
  await page.getByText('Continue planning in the message box.').waitFor();
  planned.plan.status = 'ready';
  planned.status = 'waiting';
  planned.approval = { id: 'plan-1', title: 'Build this plan?', detail: '', kind: 'plan' };
  await update('planned');
  const plan = page.getByRole('region', { name: 'Created plan' });
  await plan.getByRole('heading', { name: 'Render cache' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Allow once' }).count(),
    0,
    'the card answers it',
  );
  await plan.getByRole('button', { name: 'View Plan' }).click();
  assert.equal((await sentOf('viewPlan')).at(-1).id, 'planned');
  await plan.getByRole('combobox', { name: 'Implementation destination' }).selectOption('worker');
  await plan.getByRole('button', { name: 'Implement plan' }).click();
  assert.equal((await sentOf('buildPlan')).at(-1).agent, 'claude');
  await plan.getByRole('combobox', { name: 'Implementation destination' }).selectOption('current');
  await plan.getByRole('button', { name: 'Implement plan' }).click();
  assert.deepEqual((await sentOf('buildPlan')).at(-1), { type: 'buildPlan', id: 'planned' });
  assert.equal(await plan.getByRole('button', { name: 'Implement in Auto' }).count(), 0);
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
}
