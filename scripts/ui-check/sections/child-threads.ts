import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkChildThreads(ctx: UiCheckContext): Promise<void> {
  // Usage returns to codex-one, whose child cards remain visible.
  const { page, box, nav, sentOf } = ctx;
  // Child threads: inline, and nested in the sidebar with a working rail.
  await nav.getByRole('button', { name: 'Double-check the compiler' }).waitFor();
  await page.getByText('planCache').waitFor();
  await page.getByText('Release notes are ready for review.').waitFor();
  await page.getByRole('button', { name: 'Add this result to your next message' }).waitFor();

  // Picking an agent mid-message moves it to the front, keeping your words.
  await box.fill('');
  await box.pressSequentially('use @claude');
  await page.getByRole('option', { name: /@claude2/ }).waitFor();
  assert.match((await page.getByRole('option').first().textContent()) ?? '', /@claude/);
  await box.press('Enter');
  assert.equal(await box.getAttribute('data-value'), '@claude use ');
  await box.fill('');

  // An agent can be run from the composer without leaving the thread.
  await box.fill('@cl');
  await page.getByRole('option', { name: /@claude2/ }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/mention.png' });
  await box.press('ArrowDown');
  await box.press('Enter');
  assert.equal(await box.getAttribute('data-value'), '@claude2 ');
  // A mention doesn't replace your main agent's chip. Another one says who it goes to.
  const mainModel = await page.getByRole('button', { name: /^Model:/ }).getAttribute('aria-label');
  assert.doesNotMatch(mainModel ?? '', /Claude 2/);
  await page.locator('.composer').getByText('Claude 2', { exact: true }).waitFor();
  await box.fill('@codex Write the migration');
  assert.equal(
    await page.getByRole('button', { name: /^Model:/ }).getAttribute('aria-label'),
    mainModel,
  );
  await page.getByRole('button', { name: 'Send message' }).click();
  const [delegated] = await sentOf('delegate');
  assert.deepEqual(
    [delegated.id, delegated.agent, delegated.text],
    ['codex-one', 'codex', 'Write the migration'],
  );
  await box.fill('');

  // Model changes on a started thread update it; another agent opens a new thread with the draft.
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('option', { name: 'GPT-6-Luna' }).click();
  const [changed] = await sentOf('setModel');
  assert.deepEqual([changed.id, changed.model, changed.effort], ['codex-one', 'gpt-6-luna', null]);

  // A card says who asked, and in what words.
  const sentPrompts = page.locator('.sent-prompt');
  await sentPrompts
    .filter({ hasText: /You asked Codex|You asked Claude/ })
    .first()
    .waitFor();
  await sentPrompts.getByText('Write the release notes').first().waitFor();
  await sentPrompts
    .filter({ hasText: /Codex asked/ })
    .getByText(/cache key/)
    .first()
    .waitFor();
}
