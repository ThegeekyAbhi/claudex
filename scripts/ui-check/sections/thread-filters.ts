import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkThreadFilters(ctx: UiCheckContext): Promise<void> {
  // Uses the completed child-thread fixtures and restored claude-two mode from mode-guides.
  const { page, threads, update } = ctx;
  // Finished subagents wait behind a toggle. Running ones never do.
  await update('planned');
  const earlierToggle = threads.getByRole('button', { name: /\d+ earlier/ });
  await earlierToggle.waitFor();
  assert.equal(await threads.getByRole('button', { name: /Write release notes/ }).count(), 0);
  assert.ok(await threads.getByRole('button', { name: /Double-check the compiler/ }).count());
  await earlierToggle.click();
  await threads.getByRole('button', { name: /Write release notes/ }).waitFor();
  await threads.getByRole('button', { name: 'Hide earlier' }).click();
  await threads.getByPlaceholder('Find a thread…').fill('release notes');
  await threads.getByRole('button', { name: /Write release notes/ }).waitFor();
  await threads.getByPlaceholder('Find a thread…').fill('');
  await threads.getByRole('button', { name: 'Running only' }).click();
  assert.equal(await threads.getByRole('button', { name: /Playback review/ }).count(), 0);
  assert.ok(await threads.getByRole('button', { name: /Double-check the compiler/ }).count());
  await page.screenshot({ path: 'test-results/screenshots/running-only.png' });
  await threads.getByRole('button', { name: 'Running only' }).click();
  await threads.getByRole('button', { name: /Playback review/ }).waitFor();
}
