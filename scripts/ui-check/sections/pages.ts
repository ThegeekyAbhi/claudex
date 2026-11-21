import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkPages(ctx: UiCheckContext): Promise<void> {
  // The ⋯ menu opens today's todos and the header opens your pages; both only ask the host.
  const { page, sentOf } = ctx;
  const menu = () =>
    page.locator('main > header').getByRole('button', { name: 'More actions' }).click();
  await menu();
  await page.getByRole('menuitem', { name: 'Today’s todos' }).click();
  assert.deepEqual((await sentOf('openTodayPage')).at(-1), { type: 'openTodayPage' });
  await page.locator('main > header').getByRole('button', { name: 'All pages' }).click();
  assert.deepEqual((await sentOf('browsePages')).at(-1), { type: 'browsePages' });
}
