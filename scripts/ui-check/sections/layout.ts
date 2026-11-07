import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkLayout(ctx: UiCheckContext): Promise<void> {
  // Uses the planned fixture and restored mascot state from mascot.
  const { page, nav, update } = ctx;
  // In the side bar: no second divider, and it holds up at real panel widths.
  await page.evaluate(() => {
    document.documentElement.dataset.surface = 'view';
  });
  await update('planned');
  for (const width of [300, 360, 480]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const panel = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      border: getComputedStyle(document.querySelector('.workspace') as Element).borderLeftWidth,
      send:
        (document.querySelector('.send-button') as Element).getBoundingClientRect().right <=
        window.innerWidth,
    }));
    assert.deepEqual(
      panel,
      { overflow: false, border: '0px', send: true },
      `Side bar at ${width}px`,
    );
    await page.screenshot({ path: `test-results/screenshots/sidebar-${width}.png` });
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole('button', { name: /^Model:/ }).click();
  const panelRail = page.getByRole('tablist', { name: 'Agents' });
  assert.ok(await panelRail.getByText('Claude 2').isVisible(), 'provider names stay visible');
  assert.ok(
    await panelRail
      .getByText('Claude 2')
      .evaluate((label) => label.scrollWidth <= label.clientWidth),
    'provider names are not cut off in the side bar',
  );
  await page.screenshot({ path: 'test-results/screenshots/sidebar-model.png' });
  await page.keyboard.press('Escape');
  await update(undefined);
  // A new thread puts the composer first, with recent threads under it.
  await page.getByRole('navigation', { name: 'Recent threads' }).waitFor();
  await page
    .getByRole('button', { name: /Try Plan Mode|Mode: Auto/ })
    .first()
    .waitFor();
  await page.screenshot({ path: 'test-results/screenshots/sidebar-new-thread.png' });
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.screenshot({ path: 'test-results/screenshots/sidebar-new-model.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    delete document.documentElement.dataset.surface;
  });
  await update('codex-one');

  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 840 });
    if (width < 900) {
      const history = page.getByRole('button', { name: 'Toggle session history' });
      await history.click();
      await nav.waitFor();
      await history.click();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    // Let the resize reach the compositor, or the capture can show the old frame.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const layout = await page.evaluate(() => {
      const box = document.querySelector('.workspace')?.getBoundingClientRect();
      return {
        border: getComputedStyle(document.querySelector('.workspace') as Element).borderLeftWidth,
        top: box?.top,
        height: box?.height,
        pageHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
      };
    });
    assert.deepEqual(
      layout,
      { border: '1px', top: 0, height: 840, pageHeight: 840, scrollY: 0 },
      `Frame at ${width}px`,
    );
    await page.screenshot({ path: `test-results/screenshots/conversation-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
}
