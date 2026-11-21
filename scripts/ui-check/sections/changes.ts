import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkChanges(ctx: UiCheckContext): Promise<void> {
  // Returns from the worker selected by terminal-drafts.
  const { page, sentOf, update } = ctx;
  await update('codex-one');
  // Changes open in VS Code's own multi-file diff editor, in the main window. The webview keeps
  // no file list of its own, so nothing opens beside the chat.
  const before = (await sentOf('reviewChanges')).length;
  await page.getByRole('button', { name: 'Review changes' }).click();
  const sent = await sentOf('reviewChanges');
  assert.equal(sent.length, before + 1);
  assert.deepEqual([sent.at(-1)?.id, sent.at(-1)?.file], ['codex-one', undefined]);
  assert.equal(await page.getByRole('complementary').count(), 0, 'no side list opens');
  assert.equal(await page.getByRole('textbox', { name: 'Search changed files' }).count(), 0);

  // Icon buttons explain themselves. A click closes a tooltip until the pointer leaves.
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Review changes' }).hover();
  await page.getByRole('tooltip').waitFor();
  await page.mouse.move(0, 0);
}
