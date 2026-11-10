import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkConversation(ctx: UiCheckContext): Promise<void> {
  // Uses the initial codex-one fixture; thinking has updated its catalog.
  const { page, snapshot, sentOf, update } = ctx;
  // A thread shows thinking, steps, visible diffs, and child threads.
  await update('codex-one');
  await page.getByRole('heading', { name: 'Run Claude agent?' }).waitFor();
  await page.getByRole('region', { name: 'Changes to src/compiler.ts' }).waitFor();
  assert.ok(await page.locator('.diff-line.add').first().isVisible(), 'diffs show by default');
  const observedDiff = page.getByRole('region', { name: 'Changes to src/shell-edit.ts' });
  assert.equal(await observedDiff.count(), 0, 'observed change cards stay out of chat');
  assert.equal(await page.getByText('Observed file changes', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /Edited 1 file, ran 2 commands, read 1 file/ }).click();
  await page.getByRole('button', { name: 'Thought for 4s' }).click();
  await page.getByText('so a renamed clip could reuse').waitFor();
  await page.getByText('Failed: running').waitFor();
  const response = page
    .locator('article.assistant')
    .filter({ has: page.getByRole('button', { name: 'Copy full response' }) })
    .first();
  const responseText = await response.locator('.markdown').innerText();
  await response.getByRole('button', { name: 'Copy full response' }).click();
  const copied = (await sentOf('copy')).at(-1);
  assert.ok(copied.text.length >= responseText.length, 'copy includes the full Markdown source');
  const copyButton = response.locator('.response-copy');
  assert.equal(await copyButton.innerText(), '', 'copy is icon only');
  assert.equal(await copyButton.getAttribute('data-copied'), 'false', 'sending is not success');
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'copyResult', requestId, ok: true }, '*'),
    copied.requestId,
  );
  await page.waitForFunction(() => document.querySelector('.response-copy[data-copied="true"]'));
  await copyButton.click();
  const nextCopy = (await sentOf('copy')).at(-1);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'copyResult', requestId, ok: true }, '*'),
    copied.requestId,
  );
  assert.equal(await copyButton.getAttribute('data-copied'), 'false', 'stale success is ignored');
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'copyResult', requestId, ok: false }, '*'),
    nextCopy.requestId,
  );
  await response.getByText('Could not copy response. Try again.').waitFor({ state: 'attached' });
  assert.equal(await copyButton.getAttribute('data-copied'), 'false');
  const selection = await response.locator('.markdown').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selected = window.getSelection();
    selected?.removeAllRanges();
    selected?.addRange(range);
    (document.activeElement as HTMLElement)?.blur();
    return selected?.toString();
  });
  for (const modifier of ['Meta', 'Control']) {
    await page.keyboard.press(`${modifier}+c`);
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), selection);
    assert.equal(
      await page
        .locator('.composer-input')
        .evaluate((element) => document.activeElement === element),
      false,
    );
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.screenshot({ path: 'test-results/screenshots/conversation.png' });
  await page.getByRole('button', { name: 'Allow once' }).click();
  const [approval] = await sentOf('approve');
  assert.deepEqual([approval.id, approval.allowed], ['codex-one', true]);

  // Switching a native tool request to Auto sends intent, never an approval.
  const autoSession = snapshot.sessions[0] as Session;
  autoSession.nativeId = 'native-root';
  autoSession.nativeSettings = { approvalPolicy: 'on-request' };
  autoSession.approval = {
    id: 'native-approval',
    title: 'Run command?',
    detail: 'pnpm check',
    origin: 'provider',
  };
  await update('codex-one');
  await page.getByRole('button', { name: 'Allow in Auto' }).click();
  assert.deepEqual((await sentOf('approve')).at(-1), {
    type: 'approve',
    id: 'codex-one',
    requestId: 'native-approval',
    allowed: true,
    auto: true,
    answers: {},
  });
  assert.equal(await page.getByRole('button', { name: 'Stop and resume in Auto' }).count(), 0);
  // Already in Auto, it would be the same as Allow once.
  const modeBeforeAuto = autoSession.mode;
  autoSession.mode = 'auto';
  await update('codex-one');
  await page.locator('.composer-area[data-mode="auto"]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Allow in Auto' }).count(), 0);
  await page.getByRole('button', { name: 'Allow once' }).waitFor();
  autoSession.mode = modeBeforeAuto;
  autoSession.transition = 'stopping';
  await update('codex-one');
  await page.getByText('Stopping…', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Allow once' }).isDisabled());
  delete autoSession.transition;
  autoSession.approval = {
    id: 'approval-one',
    title: 'Run Claude agent?',
    detail: 'Double-check the plan compiler cache key.',
  };
}
