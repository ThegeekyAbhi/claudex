import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkWorktree(ctx: UiCheckContext): Promise<void> {
  // Uses the selected Claude model and acknowledged first draft from models.
  const { page, box, sentOf, update } = ctx;
  // Worktrees are opt-in, offered as a choice next to the model.
  await page.getByRole('button', { name: /^Location/ }).click();
  await page.getByRole('menuitemradio', { name: /New worktree/ }).click();
  // A mention with no prompt yet waits, instead of sending its own text to the current agent.
  await box.fill('@claude ');
  assert.equal(await page.getByRole('button', { name: 'Send message' }).isDisabled(), true);
  await box.press('Enter');
  assert.equal((await sentOf('start')).length, 1, 'a bare mention does not start a thread');
  await box.fill('@codex Try it in isolation');
  await box.press('Enter');
  const [, mentioned] = await sentOf('start');
  // A first-message mention runs in a card, and your main agent stays your main agent.
  assert.deepEqual(
    [mentioned.delegate, mentioned.text, mentioned.worktree],
    ['codex', 'Try it in isolation', true],
  );
  assert.equal(mentioned.agent, 'claude');
  // A background update during a slow start must not allow a duplicate start.
  await update(undefined);
  await box.press('Enter');
  assert.equal((await sentOf('start')).length, 2, 'Enter while starting does not start twice');
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Try it in isolation' }, '*'),
    mentioned.draftKey,
  );
  // The worktree choice applied to that thread only.
  await page.getByRole('button', { name: 'Location: local checkout' }).waitFor();
}
