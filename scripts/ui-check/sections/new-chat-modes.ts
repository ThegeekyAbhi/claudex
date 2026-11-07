import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkNewChatModes(ctx: UiCheckContext): Promise<void> {
  // Closes the changes panel before testing new-chat menus.
  const { page, box, sentOf, update } = ctx;
  // On a new chat there's room, so the @ menu opens right under the line you're typing on.
  await update(undefined);
  await box.fill('');
  await box.pressSequentially('use @');
  const newChatMenu = page.getByRole('listbox', { name: 'Add context' });
  await newChatMenu.getByRole('option', { name: /@claude2/ }).waitFor();
  const newChatPlacement = await page.evaluate(() => {
    const list = (
      document.querySelector('[aria-label="Add context"]') as Element
    ).getBoundingClientRect();
    const area = (document.querySelector('.composer textarea') as Element).getBoundingClientRect();
    return { top: list.top, areaTop: area.top, left: list.left, areaLeft: area.left };
  });
  assert.ok(newChatPlacement.top > newChatPlacement.areaTop, 'opens below the caret');
  assert.ok(
    newChatPlacement.top < newChatPlacement.areaTop + 50,
    'right under the first line, over the composer',
  );
  assert.ok(newChatPlacement.left > newChatPlacement.areaLeft + 20, 'lined up with the @');
  await page.screenshot({ path: 'test-results/screenshots/context-menu-new-chat.png' });
  await box.press('Escape');
  await box.fill('');
  // Modes: a new chat starts in Auto, and Shift+Tab cycles through Ask to Plan.
  await update(undefined);
  await box.fill('Plan the render cache');
  await page.getByRole('button', { name: 'Mode: Auto' }).waitFor();
  // On a new chat, the composer is at the top, so its menus open downward.
  await page.getByRole('button', { name: 'Mode: Auto' }).click();
  const modeMenu = page.getByRole('menuitemradio').first();
  await modeMenu.waitFor();
  const opensDown = await page.evaluate(() => ({
    menu: (document.querySelector('[role="menuitemradio"]') as Element).getBoundingClientRect().top,
    chip: (document.querySelector('.mode-chip') as Element).getBoundingClientRect().bottom,
  }));
  assert.ok(opensDown.menu > opensDown.chip, 'the mode menu opens below its chip');
  await page.screenshot({ path: 'test-results/screenshots/mode-menu-new-chat.png' });
  await page.keyboard.press('Escape');
  await box.focus();
  await box.press('Shift+Tab');
  await page.getByRole('button', { name: 'Mode: Ask' }).waitFor();
  await box.press('Shift+Tab');
  await page.getByRole('button', { name: 'Mode: Plan' }).waitFor();
  // Every mode is offered, and neither bypass nor full access is.
  await page.getByRole('button', { name: 'Mode: Plan' }).click();
  assert.deepEqual(
    (await page.getByRole('menuitemradio').allTextContents()).map(
      (item) => item.split(/(?=[A-Z])/)[0],
    ),
    ['Ask', 'Plan', 'Auto'],
  );
  await page.keyboard.press('Escape');
  await box.focus();
  await box.press('Enter');
  const planStart = (await sentOf('start')).at(-1);
  assert.equal(planStart.mode, 'plan');
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Plan the render cache' }, '*'),
    planStart.draftKey,
  );
  await page.waitForFunction(() => {
    const area = document.querySelector('textarea') as HTMLTextAreaElement | null;
    return area?.value === '';
  });
  await page.getByRole('button', { name: 'Mode: Plan' }).click();
  await page.getByRole('menuitemradio', { name: /Auto/ }).click();
}
