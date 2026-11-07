import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkOverview(ctx: UiCheckContext): Promise<void> {
  // Uses the restored agent profiles and planned thread from profiles.
  const { page, errors, update } = ctx;
  await page.evaluate(() => {
    document.body.className = '';
    document.body.classList.add('vscode-light');
  });
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('tablist', { name: 'Agents' }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/light-theme.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.body.classList.remove('vscode-light'));
  await update(undefined);
  await page.screenshot({ path: 'test-results/screenshots/overview.png' });
  assert.deepEqual(errors, []);
}
