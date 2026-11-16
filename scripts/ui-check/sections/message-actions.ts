import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

/** Built plans stay where they were written; replies branch, quote and carry over; `/btw` asides. */
export async function checkMessageActions(ctx: UiCheckContext): Promise<void> {
  const { page, snapshot, update, box, sentOf } = ctx;
  const base = snapshot.sessions.find((item) => item.id === 'planned') as unknown as Session;
  const at = Date.parse('2026-11-07T10:00:00Z');
  const thread = {
    ...base,
    id: 'actions',
    title: 'Branching thread',
    status: 'completed',
    mode: undefined,
    approval: undefined,
    parentId: undefined,
    plan: {
      text: '# Cache plan\n\nChange the key.',
      status: 'approved',
      updatedAt: at + 1_500,
      file: '/plans/cache.plan.md',
      after: 'x-a1',
    },
    messages: [
      { id: 'x-u1', role: 'user', text: 'Plan the cache', startedAt: at, nativeTurn: 'e1' },
      { id: 'x-a1', role: 'assistant', text: 'Here is the plan.', startedAt: at + 1_000 },
      { id: 'x-u2', role: 'user', text: 'Build it', startedAt: at + 2_000, nativeTurn: 'e2' },
      { id: 'x-a2', role: 'assistant', text: 'Built and tested.', startedAt: at + 3_000 },
      { id: 'x-u3', role: 'user', text: 'Anything else?', startedAt: at + 4_000, nativeTurn: 'e3' },
      { id: 'x-a3', role: 'assistant', text: 'Nothing else.', startedAt: at + 5_000 },
    ],
  };
  snapshot.sessions.push(thread as unknown as (typeof snapshot.sessions)[number]);
  await update('actions');

  // A built plan folds to one line after the message it followed, not below the newest reply.
  const folded = page.locator('.conversation-scroll .plan-folded');
  await folded.waitFor();
  const order = await page.evaluate(() => {
    const plan = document.querySelector('.conversation-scroll .plan-folded') as Element;
    const last = Array.from(document.querySelectorAll('.conversation-scroll article.assistant')).at(
      -1,
    );
    return Boolean(last && plan.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, 'the built plan stays above later turns');
  // The header chip opens it from anywhere.
  await page.getByRole('button', { name: 'Plan, built' }).click();
  const popover = page.locator('.plan-popover');
  await popover.getByRole('heading', { name: 'Cache plan' }).waitFor();
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached' });

  // Replies offer fork and new chat; your messages offer edit; both quote.
  const reply = page.locator('article.assistant', { hasText: 'Built and tested.' });
  await reply.hover();
  await reply.getByRole('button', { name: /^Fork/ }).click();
  assert.deepEqual(
    (await sentOf('fork')).at(-1),
    { type: 'fork', id: 'actions', messageId: 'x-a2' },
    'fork names the reply',
  );
  await reply.hover();
  await reply.getByRole('button', { name: 'Quote in reply' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Message your agent"]')
      ?.textContent?.includes('> Built and tested.'),
  );
  await reply.hover();
  await reply.getByRole('button', { name: 'New chat with context up to here' }).click();
  await page.getByRole('menuitem').first().waitFor();
  await page.keyboard.press('Escape');

  // Editing your message puts it back in the box with a plain warning, and sends a rewind.
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  const mine = page.locator('article.user-message', { hasText: 'Anything else?' });
  await mine.hover();
  await mine.getByRole('button', { name: 'Edit and resend from here' }).click();
  await page.getByText('Files it changed are not reverted.').waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Message your agent"]')
      ?.textContent?.includes('Anything else?'),
  );
  await page.screenshot({ path: 'test-results/screenshots/edit-banner.png' });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByText('Files it changed are not reverted.').waitFor({ state: 'detached' });

  // `/btw` asks on the side, even while a turn runs, and the answer never joins the thread.
  thread.status = 'running';
  await update('actions');
  const sends = (await sentOf('send')).length;
  await box.click();
  await page.keyboard.type('/btw which file holds the key?');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    (window as any).sent.some((message: any) => message.type === 'sideQuestion'),
  );
  const asked = (await sentOf('sideQuestion')).at(-1);
  assert.equal(asked.id, 'actions');
  assert.equal(asked.text, 'which file holds the key?');
  assert.equal((await sentOf('send')).length, sends, 'a side question is not a message');
  const side = page.getByRole('region', { name: 'Side questions' });
  // Before any text arrives the answer says it is working, not blank.
  await side.getByText('Answering…').waitFor();
  const reach = (await side.locator('.side-reach').textContent()) ?? '';
  assert.match(
    reach,
    thread.provider === 'codex' ? /· read-only · not saved$/ : /· no tools · not saved$/,
    'the header says what this agent may do for a side question',
  );
  await page.evaluate((requestId) => {
    for (const activity of ['Read src/compiler.ts', 'Read src/keys.ts'])
      window.postMessage({ type: 'sideAnswer', requestId, activity }, '*');
    window.postMessage({ type: 'sideAnswer', requestId, delta: 'It is in `compiler.ts`.' }, '*');
    window.postMessage({ type: 'sideAnswer', requestId, done: true }, '*');
  }, asked.requestId);
  await side.getByText('compiler.ts', { exact: true }).waitFor();
  await side.locator('.side-activity summary', { hasText: 'Read 2 files' }).waitFor();

  // A refused one ends with its reason and can be asked again in place.
  await box.click();
  await page.keyboard.type('/btw and the salt?');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      (window as any).sent.filter((message: any) => message.type === 'sideQuestion').length === 2,
  );
  const second = (await sentOf('sideQuestion')).at(-1);
  await page.evaluate((requestId) => {
    window.postMessage(
      {
        type: 'sideAnswer',
        requestId,
        done: true,
        error: 'Wait for a side question to finish before asking another.',
      },
      '*',
    );
  }, second.requestId);
  await side.getByRole('alert').getByText('Wait for a side question').waitFor();
  // The earlier answer folds to one line while the newest stays open.
  await side.locator('.side-folded', { hasText: 'which file holds the key?' }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/side-question-failed.png' });
  await side.getByRole('button', { name: 'Retry' }).click();
  const retried = (await sentOf('sideQuestion')).at(-1);
  assert.equal(retried.text, 'and the salt?');
  assert.notEqual(retried.requestId, second.requestId);
  assert.deepEqual(
    retried.earlier,
    [{ question: 'which file holds the key?', answer: 'It is in `compiler.ts`.' }],
    'a retry keeps the context the question was first asked with',
  );
  await page.evaluate((requestId) => {
    window.postMessage({ type: 'sideAnswer', requestId, delta: 'Next to it.' }, '*');
    window.postMessage({ type: 'sideAnswer', requestId, done: true }, '*');
  }, retried.requestId);
  await side.getByText('Next to it.').waitFor();
  await side.locator('.side-folded', { hasText: 'which file holds the key?' }).click();
  await side.getByText('compiler.ts', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.conversation-scroll').getByText('which file holds the key?').count(),
    0,
    'the aside stays out of the transcript',
  );
  await page.screenshot({ path: 'test-results/screenshots/side-question.png' });
  await side.getByRole('button', { name: 'Hide side questions' }).click();
  await page.getByRole('button', { name: 'Side questions (2)' }).waitFor();
  thread.status = 'completed';
  snapshot.sessions.splice(snapshot.sessions.indexOf(thread as never), 1);
  // The sections after this one read the planned thread.
  await update('planned');
}
