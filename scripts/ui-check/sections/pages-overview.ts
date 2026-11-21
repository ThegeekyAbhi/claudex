import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

type Sent = { type: string; [key: string]: unknown };
const now = Date.now();
const entry = (id: string, title: string, ago: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  updatedAt: now - ago,
  openTasks: 0,
  doneTasks: 0,
  ...extra,
});
const STATE = {
  today: '2026-11-21',
  todayId: 'daily/2026-11-21',
  pages: [
    entry('release-plan-3f9a1c', 'Release plan', 5 * 60_000, { openTasks: 2, doneTasks: 1 }),
    entry('daily/2026-11-21', 'Saturday, 21 November', 60 * 60_000, {
      day: '2026-11-21',
      icon: '📅',
    }),
    entry('architecture-aa11bb', 'Architecture notes', 3 * 86_400_000, { pinned: true }),
  ],
  recents: [],
  trash: [entry('old-idea-cc22dd', 'Old idea', 9 * 86_400_000)],
  overview: { sort: 'updated', filter: 'all' },
};

/**
 * The All pages tab: every page in a list with search, filters and sort, and the same row
 * actions as the side bar. It only asks the host; nothing changes here by itself.
 */
export async function checkPagesOverview(ctx: UiCheckContext): Promise<void> {
  const browser = ctx.page.context().browser();
  assert.ok(browser, 'the checks run in a browser');
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript({
    content: `
    window.sent = [];
    window.acquireVsCodeApi = () => ({
      getState: () => undefined, setState: state => state,
      postMessage: message => window.sent.push(message)
    });`,
  });
  const sentOf = (type: string): Promise<Sent[]> =>
    page.evaluate((kind) => (window as any).sent.filter((m: Sent) => m.type === kind), type);
  const send = (state: unknown) =>
    page.evaluate((value) => window.postMessage({ type: 'pages', state: value }, '*'), state);
  const titles = () =>
    page
      .getByRole('list', { name: 'Pages' })
      .locator('[data-row]')
      .evaluateAll((rows) => rows.map((row) => row.querySelector('.truncate')?.textContent));
  try {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto('http://127.0.0.1:4173/?surface=pagesOverview');
    await page.waitForFunction(() => (window as any).sent.some((m: Sent) => m.type === 'ready'));
    await send(STATE);
    await page.getByRole('heading', { name: 'All pages' }).waitFor();

    // Newest change first, with tasks and when each was edited.
    assert.deepEqual(await titles(), [
      'Release plan',
      'Saturday, 21 November',
      'Architecture notes',
    ]);
    const first = page.locator('[data-row]').first();
    assert.match(await first.innerText(), /1\/3/);
    assert.match(await first.innerText(), /5 min ago/);

    // Filters count their pages, and choosing one or a sort is kept by the host.
    await page.getByRole('tab', { name: /Pinned/ }).click();
    assert.deepEqual(await titles(), ['Architecture notes']);
    assert.deepEqual((await sentOf('pagesOverviewView')).at(-1), {
      type: 'pagesOverviewView',
      sort: 'updated',
      filter: 'pinned',
    });
    await page.getByRole('tab', { name: /All/ }).click();
    await page.getByRole('combobox').selectOption('title');
    assert.deepEqual(await titles(), [
      'Architecture notes',
      'Release plan',
      'Saturday, 21 November',
    ]);
    // A view saved earlier comes back from the host.
    await send({ ...STATE, overview: { sort: 'updated', filter: 'daily' } });
    await page.waitForFunction(() =>
      document
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent?.startsWith('Daily'),
    );
    assert.deepEqual(await titles(), ['Saturday, 21 November']);

    // The trash lists what can be restored.
    await page.getByRole('tab', { name: /Trash/ }).click();
    await page.getByRole('button', { name: 'Restore Old idea' }).click();
    assert.deepEqual((await sentOf('pageRestore')).at(-1), {
      type: 'pageRestore',
      id: 'old-idea-cc22dd',
    });

    // Search asks the host, and shows its answers with where they matched.
    await page.getByRole('tab', { name: /All/ }).click();
    await page.getByRole('searchbox', { name: 'Search pages' }).fill('rollout');
    await page.waitForFunction(() =>
      (window as any).sent.some((m: Sent) => m.type === 'pageSearch' && m.query === 'rollout'),
    );
    await page.evaluate(
      (value) =>
        window.postMessage(
          {
            type: 'pageSearchResults',
            query: 'rollout',
            results: [{ entry: value, excerpt: 'Staged rollout to 10%' }],
          },
          '*',
        ),
      STATE.pages[0],
    );
    await page.getByText('Staged rollout to 10%').waitFor();
    assert.equal(await page.getByRole('tab').count(), 0, 'filters step aside while searching');
    await page.getByRole('searchbox', { name: 'Search pages' }).press('Enter');
    assert.deepEqual((await sentOf('pageOpen')).at(-1), {
      type: 'pageOpen',
      id: 'release-plan-3f9a1c',
    });
    await page.getByRole('searchbox', { name: 'Search pages' }).fill('');

    // Keyboard: arrows move between pages, F2 renames, Delete trashes.
    await page.locator('[data-row]').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.match(
      await page.evaluate(() => document.activeElement?.textContent ?? ''),
      /Saturday, 21 November/,
    );
    await page.keyboard.press('F2');
    const name = page.getByRole('textbox', { name: 'Page name' });
    await name.fill('Saturday plan');
    await name.press('Enter');
    assert.deepEqual((await sentOf('pageRename')).at(-1), {
      type: 'pageRename',
      id: 'daily/2026-11-21',
      title: 'Saturday plan',
    });
    await page.locator('[data-row]').first().focus();
    await page.keyboard.press('Delete');
    assert.deepEqual((await sentOf('pageTrash')).at(-1), {
      type: 'pageTrash',
      id: 'release-plan-3f9a1c',
    });

    // New page opens a dialog: name it, pick an icon and a starter, and only then ask the host.
    await page.getByRole('button', { name: 'New page' }).click();
    const dialog = page.getByRole('dialog', { name: 'New page' });
    await dialog.waitFor();
    const create = dialog.getByRole('button', { name: /^Create/ });
    assert.equal(await create.isDisabled(), true, 'a page needs a name first');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('placeholder')),
      'Untitled page',
      'the name field takes the cursor',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await sentOf('pageNew')).length, 0, 'Escape creates nothing');

    await page.getByRole('button', { name: 'New page' }).click();
    await dialog.getByRole('textbox', { name: 'Page name' }).fill('  Launch   checklist ');
    await dialog.getByRole('button', { name: 'Add an icon' }).click();
    await page.getByRole('button', { name: 'Use ✅' }).click();
    // The whole card is the radio's label, so a click anywhere on it chooses it.
    await dialog.getByText('Checklist', { exact: true }).click();
    assert.equal(await dialog.getByRole('radio', { name: /^Checklist/ }).isChecked(), true);
    await page.screenshot({ path: 'test-results/screenshots/new-page-dialog.png' });
    await dialog.getByRole('textbox', { name: 'Page name' }).press('Enter');
    assert.deepEqual((await sentOf('pageNew')).at(-1), {
      type: 'pageNew',
      title: 'Launch checklist',
      icon: '✅',
      starter: 'checklist',
    });
    await dialog.waitFor({ state: 'detached' });

    // A narrow tab never scrolls sideways.
    await page.setViewportSize({ width: 380, height: 700 });
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          (document.querySelector('.pages-overview') as HTMLElement).scrollWidth <=
            window.innerWidth,
      ),
      'the list fits a narrow tab',
    );
    assert.deepEqual(errors, [], 'the All pages tab loads cleanly under the policy');
  } finally {
    await page.close();
  }
}
