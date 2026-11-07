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
  const recent = page.getByRole('navigation', { name: 'Recent threads' });
  await recent.waitFor();
  assert.equal(
    await recent
      .getByRole('button')
      .filter({ hasNotText: /^View all/ })
      .count(),
    3,
    'the new-chat screen lists only the three most recent threads',
  );
  await recent.getByRole('button', { name: /^View all \d+$/ }).waitFor();
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
  await checkResizablePanes(ctx);
}

/** Wide, the thread list is a resizable pane that folds away; narrow, there are no handles. */
async function checkResizablePanes(ctx: UiCheckContext): Promise<void> {
  const { page, nav } = ctx;
  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  await frame();
  // The pane, not the list: folded, the pane is what shrinks to nothing.
  const width = () =>
    nav.evaluate(
      (element) => (element.closest('[data-panel]') ?? element).getBoundingClientRect().width,
    );
  if ((await width()) < 1) {
    await page.getByRole('button', { name: 'Toggle thread list' }).click();
    await frame();
  }
  const before = await width();
  assert.ok(before >= 180 && before <= 400, `thread list reopens at a usable width, got ${before}`);

  const handle = page.getByRole('separator', { name: 'Resize thread list' });
  const box = await handle.boundingBox();
  assert.ok(box, 'the thread list has a resize handle');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await frame();
  const dragged = await width();
  assert.ok(dragged > before + 40, `dragging widens the thread list (${before} → ${dragged})`);

  // The keyboard works too: the handle is a focusable separator.
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await frame();
  assert.ok((await width()) < dragged, 'arrow keys resize the thread list');

  const toggle = page.getByRole('button', { name: 'Toggle thread list' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await toggle.click();
  await frame();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.ok((await width()) < 1, 'the thread list folds away');
  assert.equal(
    await nav.evaluate((element) => Boolean(element.closest('[inert]'))),
    true,
    'a folded thread list is out of the Tab order',
  );
  await page.screenshot({ path: 'test-results/screenshots/threads-folded.png' });
  // Opening and closing a side pane re-sizes the panes, and must not unfold what you folded.
  const changesToggle = page.getByRole('button', { name: 'Toggle changes' });
  await changesToggle.click();
  await frame();
  await frame();
  assert.ok((await width()) < 1, 'a side pane opening keeps the thread list folded');
  await changesToggle.click();
  await frame();
  await frame();
  assert.ok((await width()) < 1, 'a side pane closing keeps the thread list folded');
  // ⌘K unfolds it and puts the cursor in its search.
  await page.keyboard.press('ControlOrMeta+k');
  await frame();
  await frame();
  assert.ok((await width()) > 150, '⌘K unfolds the thread list');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'thread-search',
    '⌘K focuses the search of a folded list',
  );
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('.workspace')?.classList.contains('show-history'),
    ),
    false,
    'wide, ⌘K leaves the narrow overlay closed',
  );
  await toggle.click();
  await frame();
  await toggle.click();
  await frame();
  assert.ok((await width()) > 150, 'the thread list comes back');
  await page.screenshot({ path: 'test-results/screenshots/threads-resized.png' });

  await page.setViewportSize({ width: 768, height: 840 });
  await frame();
  assert.equal(await page.getByRole('separator').count(), 0, 'no resize handles when narrow');
  assert.equal(await toggle.count(), 0);
  await page.setViewportSize({ width: 1440, height: 960 });
  await frame();
  await frame();
  assert.ok((await width()) > 150, 'an unfolded list comes back unfolded');
  // A list you folded stays folded through a narrow window and back.
  await toggle.click();
  await frame();
  await page.setViewportSize({ width: 768, height: 840 });
  await frame();
  await page.setViewportSize({ width: 1440, height: 960 });
  await frame();
  await frame();
  assert.ok((await width()) < 1, 'a folded list stays folded after the window narrows and widens');
  await page.getByRole('button', { name: 'Toggle thread list' }).click();
  await frame();
}
