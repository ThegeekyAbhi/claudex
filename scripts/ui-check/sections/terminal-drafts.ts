import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkTerminalDrafts(ctx: UiCheckContext): Promise<void> {
  // Continues codex-one after the model change in child-threads.
  const { page, snapshot, box, sentOf, update } = ctx;
  // A thread in its terminal says so, and the composer steps aside without losing your draft.
  await box.fill('Keep this draft');
  const terminalThread = snapshot.sessions.find((item) => item.id === 'codex-one') as any;
  const terminalBefore = {
    nativeId: terminalThread.nativeId,
    approval: terminalThread.approval,
    status: terminalThread.status,
  };
  await page.getByRole('button', { name: 'Open in terminal' }).waitFor();
  terminalThread.nativeId = 'native-root';
  terminalThread.inTerminal = true;
  terminalThread.approval = undefined;
  terminalThread.status = 'idle';
  await update('codex-one');
  await page.getByRole('button', { name: 'Back to chat' }).click();
  assert.equal((await sentOf('terminalBack')).at(-1).id, 'codex-one');
  await page.getByRole('button', { name: 'Show terminal' }).click();
  assert.equal((await sentOf('terminal')).at(-1).id, 'codex-one');
  await page.getByRole('img', { name: 'In terminal' }).first().waitFor();
  await page.screenshot({ path: 'test-results/screenshots/terminal-strip.png' });
  terminalThread.inTerminal = false;
  Object.assign(terminalThread, terminalBefore);
  await update('codex-one');
  assert.equal(await box.getAttribute('data-value'), 'Keep this draft');
  await box.fill('');

  // Per-thread drafts survive switching.
  await box.fill('Draft for Codex');
  await update('claude-two');
  await box.fill('Draft for Claude');
  await update('codex-one');
  assert.equal(await box.getAttribute('data-value'), 'Draft for Codex');
  await update('claude-two');
  await box.press('Meta+Enter');
  const [sentMessage] = await sentOf('send');
  assert.deepEqual([sentMessage.id, sentMessage.text], ['claude-two', 'Draft for Claude']);

  await update('worker');
  await page.getByText('manages this worker from its lead thread').waitFor();
  assert.equal(await box.count(), 0);
}
