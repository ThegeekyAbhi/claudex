import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkContinueAgent(ctx: UiCheckContext): Promise<void> {
  // Uses the planned thread restored after the hostile visual checks.
  const { page, snapshot, box, sentOf, update, quiet } = ctx;
  // Continuing in another agent moves the draft with a context chip, and sends nothing by itself.
  const continueSource = {
    ...(snapshot.sessions.find((item) => item.id === 'planned') as object),
    id: 'continue-source',
    title: 'Cache the render graph',
    provider: 'codex',
    profileId: undefined,
    parentId: undefined,
    plan: undefined,
    approval: undefined,
    status: 'completed',
    messages: [
      { id: 'cs1', role: 'user', text: 'Cache the render graph' },
      { id: 'cs2', role: 'assistant', text: 'Added a cache keyed by node hash.' },
    ],
  };
  const continueLinked = {
    ...continueSource,
    id: 'continue-linked',
    title: 'Review the cache',
    provider: 'claude',
    continuedFrom: 'continue-source',
    messages: [{ id: 'cl1', role: 'assistant', text: 'Reviewed.' }],
  };
  snapshot.sessions.push(continueSource as any, continueLinked as any);
  await update('continue-source');
  await page.getByRole('button', { name: /Continued in Claude: Review the cache/ }).waitFor();
  await box.fill('Carry on from here');
  const quietBefore = await quiet();
  await page.locator('main > header').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Continue in Claude 2' }).click();
  const contextChip = page.getByRole('button', {
    name: 'Preview Context from Cache the render graph',
  });
  await contextChip.waitFor();
  assert.equal(
    await box.getAttribute('data-value'),
    'Carry on from here',
    'the draft moves with you',
  );
  const continuedModel = await page
    .getByRole('button', { name: /^Model:/ })
    .getAttribute('aria-label');
  assert.match(continuedModel ?? '', /Claude 2/);
  assert.doesNotMatch(continuedModel ?? '', /gpt/i, 'no Codex model carries over to Claude');
  assert.equal(await quiet(), quietBefore, 'switching sends nothing by itself');
  await contextChip.click();
  assert.deepEqual((await sentOf('previewContext')).at(-1), {
    type: 'previewContext',
    id: 'continue-source',
    history: 'recent',
  });
  await page.screenshot({ path: 'test-results/screenshots/continue-chip.png' });
  await box.press('Enter');
  const continuedStart = (await sentOf('start')).at(-1);
  assert.equal(continuedStart.agent, 'claud2');
  assert.equal(continuedStart.continuedFrom, 'continue-source');
  assert.deepEqual(continuedStart.attachments, [
    { kind: 'thread', id: 'continue-source', title: 'Cache the render graph', history: 'recent' },
  ]);
  await page.evaluate(
    (draftKey) =>
      window.postMessage({ type: 'sent', id: draftKey, text: 'Carry on from here' }, '*'),
    continuedStart.draftKey,
  );
  // Going back to an agent with a linked thread resumes that thread instead of starting one.
  await update('continue-source');
  await box.fill('Check it again');
  await page.locator('main > header').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Continue in Claude', exact: true }).click();
  assert.equal((await sentOf('select')).at(-1).id, 'continue-linked');
  await page
    .getByRole('button', { name: /Continued from Codex: Cache the render graph/ })
    .waitFor();
  await contextChip.waitFor();
  assert.equal(await box.getAttribute('data-value'), 'Check it again');
  await box.press('Enter');
  const resumed = (await sentOf('send')).at(-1);
  assert.equal(resumed.id, 'continue-linked');
  assert.deepEqual(resumed.attachments, [
    { kind: 'thread', id: 'continue-source', title: 'Cache the render graph', history: 'recent' },
  ]);
  await page.evaluate(() =>
    window.postMessage({ type: 'sent', id: 'continue-linked', text: 'Check it again' }, '*'),
  );
  snapshot.sessions.splice(
    snapshot.sessions.findIndex((item) => item.id === 'continue-source'),
    2,
  );
  await update('planned');
}
