import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkContextMenu(ctx: UiCheckContext): Promise<void> {
  // Starts on the planned thread left by images, then selects an idle thread.
  const { page, box, sentOf, update } = ctx;
  // The @ and # menu: recent files, categories, drill-in, chips.
  await box.fill('Look at ');
  await box.press('End');
  await box.pressSequentially('@');
  await page.waitForFunction(() =>
    (window as any).sent.some((message: any) => message.type === 'searchContext'),
  );
  const searchId = (await sentOf('searchContext')).at(-1).requestId;
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        {
          type: 'contextResults',
          requestId,
          recent: ['src/compiler.ts'],
          matches: [
            { kind: 'file', path: 'src/compiler.ts' },
            { kind: 'folder', path: 'src/webview' },
          ],
          terminals: ['zsh'],
        },
        '*',
      ),
    searchId,
  );
  const menu = page.getByRole('listbox', { name: 'Add context' });
  for (const name of [
    /compiler\.ts/,
    /Files & Folders/,
    /Past Threads/,
    /Terminals/,
    /Branch/,
    /Images/,
  ])
    await menu.getByRole('option', { name }).waitFor();
  // Agents are offered mid-message, after the recent file so Enter still adds context.
  const midRows = await menu.getByRole('option').allTextContents();
  assert.match(midRows[0] ?? '', /compiler\.ts/);
  await menu.getByRole('option', { name: /@claude2/ }).waitFor();
  // The menu sits under the @, not at the composer's edge.
  const placement = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="Add context"]') as Element;
    const area = document.querySelector('.composer textarea') as Element;
    return {
      list: list.getBoundingClientRect().toJSON(),
      area: area.getBoundingClientRect().toJSON(),
      viewport: window.innerHeight,
    };
  });
  assert.ok(placement.list.left > placement.area.left + 30, 'the menu follows the caret');
  assert.ok(placement.list.left < placement.area.left + 140, 'and stays near it');
  assert.ok(placement.list.bottom <= placement.viewport, 'the menu stays on screen');
  await page.screenshot({ path: 'test-results/screenshots/context-menu.png' });
  await box.press('Enter');
  assert.equal(await box.inputValue(), 'Look at ', 'the token leaves the text');
  await page.locator('.composer .attachment-chip').getByText('compiler.ts').waitFor();
  // # goes straight to files, and a category drills in with the arrow key.
  await box.pressSequentially('#');
  await menu.getByRole('option', { name: /webview/ }).waitFor();
  await box.press('ArrowDown');
  await box.press('Enter');
  await page.locator('.composer .attachment-chip').getByText('webview').waitFor();
  await box.pressSequentially('@');
  await menu.getByRole('option', { name: /Past Threads/ }).waitFor();
  // Past the recent file, the three agents, and Files & Folders.
  for (let step = 0; step < 5; step++) await box.press('ArrowDown');
  await box.press('ArrowRight');
  await menu.getByRole('option', { name: 'Playback review' }).waitFor();
  await box.press('Escape');
  await box.fill('');
  // That thread is waiting on its plan, so the send itself uses an idle thread.
  await update('claude-two');
  await box.fill('@');
  await menu.getByRole('option', { name: /Branch/ }).click();
  assert.equal(await box.inputValue(), '');
  await page.locator('.composer .attachment-chip').getByText('Branch diff').waitFor();
  await box.fill('Review this');
  await box.press('Enter');
  const withContext = (await sentOf('send')).at(-1);
  assert.deepEqual(withContext.attachments, [{ kind: 'diff' }]);
  await page.evaluate(() =>
    window.postMessage({ type: 'sent', id: 'claude-two', text: 'Review this' }, '*'),
  );
  await page.locator('.composer .attachment-chip').waitFor({ state: 'detached' });
}
