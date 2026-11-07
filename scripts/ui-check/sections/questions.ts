import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkQuestions(ctx: UiCheckContext): Promise<void> {
  // Retains the restored approval fixture from conversation.
  const { page, snapshot, sentOf, update } = ctx;
  // Questions dock on the composer, one at a time, and answer from the keyboard.
  snapshot.sessions.push({
    id: 'asking',
    title: 'Choose the release',
    provider: 'codex',
    cwd: '/Projects/studio',
    workspace: '/Projects/studio',
    status: 'waiting',
    createdAt: 8,
    updatedAt: Date.now(),
    mode: 'auto',
    runtime: { mcpServers: [{ name: 'figma', status: 'failed' }] },
    usage: {
      context: { used: 176_000, max: 200_000 },
      limits: [
        { id: 'primary', label: '5-hour', usedPercent: 31, resetsAt: Date.now() + 8_000_000 },
        { id: 'secondary', label: 'Weekly', usedPercent: 12, resetsAt: Date.now() + 400_000_000 },
        { id: 'stale', label: 'Expired', usedPercent: 99, resetsAt: Date.now() - 1000 },
      ],
      updatedAt: Date.now() - 120_000,
    },
    approval: {
      id: 'q-1',
      title: 'Your input is needed',
      detail: '',
      questions: [
        {
          id: 'lead',
          prompt: 'Which outcome should lead the first release?',
          options: ['Skills and context (Recommended)', 'Long-running reliability', 'UI redesign'],
          details: { 'Long-running reliability': 'Fewer stalled turns' },
        },
        {
          id: 'problem',
          prompt: 'What describes the skills problem?',
          options: ['Hard to discover', 'Agent ignores skills'],
          multiple: true,
        },
        { id: 'note', prompt: 'Anything else?', options: [] },
      ],
    },
    messages: [{ id: 'au', role: 'user', text: 'Plan the release' }],
  } as unknown as (typeof snapshot.sessions)[number]);
  await update('asking');
  const questionCard = page.getByRole('region', { name: 'Agent questions' });
  await questionCard.getByText('1 of 3').waitFor();
  // An empty composer gives the keyboard to the questions.
  // Polled from here because the page's CSP rules out waitForFunction's eval.
  await assert.doesNotReject(async () => {
    for (let tries = 0; tries < 40; tries++) {
      const focused = await questionCard.evaluate((card) => card.contains(document.activeElement));
      if (focused) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('The question card did not take focus.');
  });
  await questionCard.getByText('Recommended', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/questions.png' });
  const continueButton = questionCard.getByRole('button', { name: /Continue/ });
  assert.equal(await continueButton.isDisabled(), true, 'an answer is needed to move on');
  await page.keyboard.press('b');
  assert.equal(
    await questionCard.getByRole('radio', { name: /Long-running/ }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Enter');
  await questionCard.getByText('2 of 3').waitFor();
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await questionCard.getByText('3 of 3').waitFor();
  await questionCard.getByRole('textbox').fill('Ship it');
  await questionCard.getByRole('textbox').press('Enter');
  const [answered] = (await sentOf('approve')).filter((item: any) => item.requestId === 'q-1');
  assert.deepEqual(answered.answers, {
    lead: 'Long-running reliability',
    problem: 'Hard to discover, Agent ignores skills',
    note: 'Ship it',
  });
  // Esc tells the agent you declined, and reports no answers.
  await update(undefined);
  await questionCard.waitFor({ state: 'detached' });
  await update('asking');
  await questionCard.getByText('1 of 3').waitFor();
  await questionCard.focus();
  await page.keyboard.press('Escape');
  const skipped = (await sentOf('approve')).filter((item: any) => item.requestId === 'q-1').at(-1);
  assert.deepEqual([skipped.allowed, skipped.answers], [false, {}]);
}
