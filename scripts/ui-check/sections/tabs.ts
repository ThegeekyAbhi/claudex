import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkTabs(ctx: UiCheckContext): Promise<void> {
  // Uses the unfiltered sidebar restored by thread-filters.
  const { threads, page, snapshot, box, tablist, sentOf, update, tabNamed, draftTabs } = ctx;
  // Open threads are tabs. A new one doesn't disturb the others, and closing one stops nothing.
  await update('claude-two');
  await update('planned');
  await tabNamed(/Playback review/).waitFor();
  await tabNamed(/Plan the cache/).waitFor();
  // Every click is a new chat, and what you typed stays in its own tab, sent or not.
  const draftsBefore = await draftTabs();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await box.fill('unsent words');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  assert.equal(await draftTabs(), draftsBefore + 3);
  assert.equal(await box.getAttribute('data-value'), '', 'a new chat starts empty');
  await tabNamed(/Plan the cache/).waitFor();
  await tabNamed(/unsent words/).click();
  assert.equal(await box.getAttribute('data-value'), 'unsent words');
  await page.screenshot({ path: 'test-results/screenshots/draft-tabs.png' });
  await update('planned');
  await tabNamed(/unsent words/).waitFor();
  await page.getByRole('button', { name: 'Close unsent words' }).click({ force: true });
  await page.waitForFunction(
    () => !document.querySelector('[role="tablist"]')?.textContent?.includes('unsent words'),
  );
  // Which threads need you shows on their tabs, and only until you've looked.
  const backgrounded = snapshot.sessions.find(
    (item) => item.id === 'claude-two',
  ) as unknown as Session;
  backgrounded.status = 'waiting';
  await update('planned');
  await tablist.getByRole('img', { name: 'Needs your review' }).first().waitFor();
  backgrounded.status = 'completed';
  backgrounded.updatedAt = Date.now() + 60_000;
  await update('planned');
  await tablist.getByRole('img', { name: 'Finished since you last looked' }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/thread-tabs.png' });
  await tabNamed(/Playback review/).click();
  assert.equal((await sentOf('select')).at(-1).id, 'claude-two');
  await update('claude-two');
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Finished since you last looked"]'),
  );
  backgrounded.status = 'idle';
  await update('planned');
  const interruptsBefore = (await sentOf('interrupt')).length;
  await page.getByRole('button', { name: 'Close Playback review' }).click({ force: true });
  await page.waitForFunction(
    () => !document.querySelector('[role="tablist"]')?.textContent?.includes('Playback review'),
  );
  assert.equal((await sentOf('interrupt')).length, interruptsBefore, 'closing a tab stops nothing');
  await threads.getByRole('button', { name: /Playback review/ }).waitFor();
  // Closing the open tab moves to its neighbour, and a snapshot already on its way can't undo it.
  await update('claude-two');
  await page.getByRole('button', { name: 'Close Playback review' }).click();
  await page.evaluate(
    (snapshot) => window.postMessage({ type: 'snapshot', snapshot, selectedId: 'claude-two' }, '*'),
    snapshot,
  );
  await page.waitForTimeout(100);
  assert.equal(await tabNamed(/Playback review/).count(), 0, 'a stale snapshot stays closed');
  await update('planned');
  await tablist.getByRole('tab', { name: /Plan the cache/ }).waitFor();
}
