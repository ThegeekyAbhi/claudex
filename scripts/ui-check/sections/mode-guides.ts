import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkModeGuides(ctx: UiCheckContext): Promise<void> {
  // Uses the Cursor dark appearance left by appearance and the shared thinking locator.
  const { page, catalog, snapshot, box, thinkingToggle, sentOf, update, luminance } = ctx;
  // Every mode has its own colour on the chip and send button, and stays readable.
  const moded = snapshot.sessions.find((item) => item.id === 'claude-two') as unknown as Session;
  const modeColors: Record<string, string> = {};
  for (const mode of ['ask', 'plan', 'auto'] as const) {
    moded.mode = mode;
    moded.status = 'idle';
    await update('claude-two');
    await page.locator(`.composer-area[data-mode="${mode}"]`).waitFor();
    const colors = await page.evaluate(() => {
      const send = getComputedStyle(document.querySelector('.send-button') as Element);
      const chip = getComputedStyle(document.querySelector('.mode-chip') as Element);
      return { fill: send.backgroundColor, icon: send.color, chip: chip.color };
    });
    assert.equal(colors.chip, colors.fill, `${mode} chip matches its send button`);
    const [light, dark] = [luminance(colors.fill), luminance(colors.icon)].sort((a, b) => b - a);
    const contrast = (light + 0.05) / (dark + 0.05);
    assert.ok(contrast >= 4.5, `${mode} send contrast is ${contrast.toFixed(2)}`);
    modeColors[mode] = colors.fill;
    await page.screenshot({ path: `test-results/screenshots/cursor-${mode}.png` });
  }
  assert.equal(new Set(Object.values(modeColors)).size, 3, 'each mode looks different');

  // Guides can be chosen, one click each, from the mode that uses them.
  moded.mode = 'plan';
  await update('claude-two');
  await page.locator('.composer-area[data-mode="plan"]').waitFor();
  const planGuide = page.getByRole('button', { name: 'Planning guide' });
  assert.equal(await planGuide.getAttribute('aria-pressed'), 'true');
  await planGuide.click();
  assert.deepEqual((await sentOf('setGuide')).at(-1), {
    type: 'setGuide',
    guide: 'guidedPlanning',
    enabled: false,
  });
  moded.mode = 'ask';
  await update('claude-two');
  await page.locator('.composer-area[data-mode="ask"]').waitFor();
  await page.getByRole('button', { name: 'Visual explanations' }).click();
  assert.equal((await sentOf('setGuide')).at(-1).guide, 'richExplanations');
  moded.mode = 'auto';
  await update('claude-two');
  await page.locator('.composer-area[data-mode="auto"]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Planning guide' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Visual explanations' }).count(), 0);

  // On a thread, the toggle tells the host what it chose.
  assert.equal(await thinkingToggle.isDisabled(), true, 'an unknown model has nothing to offer');
  const toggleModel = catalog.claude.models[0];
  (toggleModel as { adaptiveThinking?: boolean }).adaptiveThinking = true;
  moded.model = toggleModel.id;
  await update('claude-two');
  await thinkingToggle.click();
  assert.equal((await sentOf('setThinking')).at(-1).thinking, 'on');
  delete (toggleModel as { adaptiveThinking?: boolean }).adaptiveThinking;
  delete moded.model;

  // A completed reply in Plan mode is not evidence that a plan exists.
  moded.mode = 'plan';
  moded.status = 'completed';
  await update('claude-two');
  const sendsBefore = (await sentOf('send')).length;
  await box.fill('One more thing');
  assert.equal(await page.getByRole('button', { name: 'Implement', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Yes, implement in Auto/ }).count(), 0);
  assert.equal(await box.getAttribute('data-value'), 'One more thing');
  assert.equal((await sentOf('send')).length, sendsBefore);
  await box.fill('');
  moded.mode = undefined;
  moded.status = 'idle';
}
