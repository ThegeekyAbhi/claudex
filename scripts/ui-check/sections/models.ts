import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkModels(ctx: UiCheckContext): Promise<void> {
  // Starts with the fresh page prepared by the runner.
  const { page, box, sentOf, update } = ctx;
  // The panel fills the webview despite VS Code's injected body padding, with a left divider.
  const frame = await page.evaluate(() => ({
    padding: getComputedStyle(document.body).paddingLeft,
    left: document.querySelector('.workspace')?.getBoundingClientRect().left,
    border: getComputedStyle(document.querySelector('.workspace') as Element).borderLeftWidth,
    font: getComputedStyle(document.body).fontFamily.split(',')[0].trim() === 'system-ui',
  }));
  assert.deepEqual(frame, { padding: '0px', left: 0, border: '1px', font: true });

  // A new thread asks nothing: pick an agent and model in place, type, press Enter.
  await update(undefined);
  await page.getByRole('button', { name: /^Model: Codex/ }).waitFor();
  await page.getByRole('button', { name: /^Model:/ }).click();
  const rail = page.getByRole('tablist', { name: 'Agents' });
  assert.deepEqual(
    await rail
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))),
    ['Claude', 'Claude 2', 'Codex'],
    'providers are listed in the requested order',
  );
  await page.getByRole('option', { name: 'GPT-6.1-Sol' }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'Sonnet 5.5' }).count(), 0);
  await page.screenshot({ path: 'test-results/screenshots/model-selector.png' });
  // Choosing a provider on the left shows its models on the right, by mouse or arrow key.
  await rail.getByRole('tab', { name: 'Claude', exact: true }).click();
  await page.getByRole('option', { name: 'Sonnet 5.5' }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'GPT-6.1-Sol' }).count(), 0);
  // Older versions wait behind More models.
  assert.equal(await page.getByRole('option', { name: 'Opus 4.8' }).count(), 0);
  await page.getByRole('option', { name: /More models/ }).click();
  // The highlight moves to the first revealed row, with its description inline.
  await page.getByRole('option', { name: 'Opus 4.8', selected: true }).waitFor();
  await page
    .getByRole('option', { name: 'Opus 4.8' })
    .getByText('Best for everyday, complex tasks')
    .waitFor();
  await page.screenshot({ path: 'test-results/screenshots/model-selector-claude.png' });
  const search = page.getByRole('combobox');
  await search.focus();
  await search.press('ArrowRight');
  await rail.getByRole('tab', { name: 'Claude 2', exact: true, selected: true }).waitFor();
  assert.ok(
    await rail.getByText('Claude 2').evaluate((label) => label.scrollWidth <= label.clientWidth),
    'provider names are not cut off in the editor layout',
  );
  await page.getByText('Could not read this CLI’s models.').waitFor();
  await search.press('ArrowLeft');
  await rail.getByRole('tab', { name: 'Claude', exact: true, selected: true }).waitFor();
  // Search looks across every agent, including older versions.
  await search.fill('opus 4');
  await page.getByRole('option', { name: 'Opus 4.8' }).waitFor();
  await search.fill('sonnet');
  await page.screenshot({ path: 'test-results/screenshots/model-selector-search.png' });
  assert.equal(await page.getByRole('option').count(), 1, 'search filters across agents');
  await search.press('Enter');
  await page.getByRole('button', { name: /^Model: Claude Sonnet/ }).waitFor();
  // Effort has its own menu, for the levels the chosen model supports.
  await page.getByRole('button', { name: 'Model: Claude Sonnet 5.5' }).waitFor();
  await page.getByRole('button', { name: /^Effort:/ }).click();
  assert.equal(await page.getByRole('menuitemradio').count(), 4, 'default plus three levels');
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await page.getByRole('button', { name: 'Effort: High' }).waitFor();
  await box.fill('Fix the login bug');
  await box.press('Shift+Enter');
  assert.equal((await sentOf('start')).length, 0, 'Shift+Enter is a new line');
  await box.fill('Fix the login bug');
  await box.press('Enter');
  const [started] = await sentOf('start');
  assert.deepEqual(
    [started.agent, started.model, started.effort, started.text, started.worktree],
    ['claude', 'sonnet', 'high', 'Fix the login bug', undefined],
  );
  // The first message is held until the host confirms it, so a failure cannot lose the draft.
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Fix the login bug' }, '*'),
    started.draftKey,
  );
}
