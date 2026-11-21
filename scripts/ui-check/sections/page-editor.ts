import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import type { UiCheckContext } from '../context';

const PAGE = [
  '---',
  'icon: 📅',
  '---',
  '',
  '# Saturday, 21 November',
  '',
  '## Top priorities',
  '',
  '- [ ] Run propulsion test',
  '- [x] Verify course calculations',
  '',
  'Notes',
  '',
].join('\n');

type Sent = { type: string; [key: string]: unknown };
const sentOf = async (page: Page, type: string): Promise<Sent[]> =>
  page.evaluate((kind) => (window as any).sent.filter((item: Sent) => item.type === kind), type);
const lastEdit = async (page: Page): Promise<string> =>
  ((await sentOf(page, 'pageEdit')).at(-1)?.text as string | undefined) ?? '';

/**
 * The page editor tab: Crepe under the extension's policy, to-dos, the slash menu, `@` mentions,
 * and the page's own chat. It runs on its own tab, as VS Code gives each page its own webview.
 */
export async function checkPageEditor(ctx: UiCheckContext): Promise<void> {
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
  try {
    await page.goto('http://127.0.0.1:4173/?surface=page');
    await page.waitForFunction(() => (window as any).sent.some((m: Sent) => m.type === 'ready'));
    const state = {
      id: 'daily/2026-11-21',
      text: PAGE,
      suggestions: [],
      threads: [],
      agents: [{ id: 'codex', label: 'Codex', agent: 'codex' }],
      pages: [{ id: 'release-plan-3f9a1c', title: 'Release plan' }],
      trusted: true,
    };
    await page.evaluate((value) => window.postMessage({ type: 'page', state: value }, '*'), state);
    await page.locator('.milkdown .ProseMirror').waitFor();

    // A done to-do is drawn checked, dimmed and struck through.
    const done = page.locator('.milkdown-list-item-block li', { hasText: 'Verify course' });
    await done.locator('.label-wrapper .checked').waitFor();
    const decoration = await done
      .locator('.children')
      .evaluate((element) => getComputedStyle(element).textDecorationLine);
    assert.match(decoration, /line-through/, 'a done to-do is struck through');

    // `/` opens Crepe's grouped block menu, with our own Insert group.
    await page.getByText('Notes', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const menu = page.locator('.milkdown-slash-menu');
    await menu.waitFor({ state: 'visible' });
    for (const group of ['Basic blocks', 'Lists', 'Media', 'Insert'])
      await menu.locator('h6', { hasText: group }).first().waitFor();
    // One quiet list, as in Notion: no tab strip, and each block says what it is for.
    assert.equal(await menu.locator('.tab-group').isVisible(), false);
    await menu.locator('li', { hasText: 'To-do list' }).getByText('Track tasks').waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');

    // `[] ` starts a to-do, as in Notion.
    await page.keyboard.type('[] ');
    await page.waitForTimeout(60);
    await page.keyboard.type('Learn distributed systems', { delay: 5 });
    await page.waitForFunction(() =>
      (window as any).sent
        .filter((m: Sent) => m.type === 'pageEdit')
        .at(-1)
        ?.text.includes('- [ ] Learn distributed systems'),
    );

    // `@` mentions a workspace file, which the host finds, as an ordinary Markdown link.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    await page.keyboard.type('See @app', { delay: 5 });
    await page.waitForFunction(() =>
      (window as any).sent.some((m: Sent) => m.type === 'pageSearchFiles' && m.query === 'app'),
    );
    const search = (await sentOf(page, 'pageSearchFiles')).at(-1);
    await page.evaluate(
      (requestId) =>
        window.postMessage(
          {
            type: 'pageFileResults',
            requestId,
            matches: [{ path: 'src/webview/app/app.tsx', name: 'app.tsx' }],
          },
          '*',
        ),
      search?.requestId,
    );
    const mention = page.getByRole('listbox', { name: 'Mention' });
    await mention.getByRole('option', { name: /app\.tsx/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      (window as any).sent
        .filter((m: Sent) => m.type === 'pageEdit')
        .at(-1)
        ?.text.includes('[app.tsx](src/webview/app/app.tsx)'),
    );
    assert.match(await lastEdit(page), /^icon: 📅$/m, 'front matter is kept');
    // Typing right after a mention stays plain text, outside the link.
    await page.keyboard.type('next', { delay: 5 });
    await page.waitForFunction(() =>
      (window as any).sent
        .filter((m: Sent) => m.type === 'pageEdit')
        .at(-1)
        ?.text.includes('[app.tsx](src/webview/app/app.tsx) next'),
    );
    assert.equal(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ProseMirror a')).some((a) =>
          a.textContent?.includes('next'),
        ),
      ),
      false,
      'text typed after a mention is not part of its link',
    );

    // Sending from the page starts its chat there; the reply streams into the page.
    const box = page.getByRole('textbox', { name: 'Message to an agent about this page' });
    await box.fill('Add learn distributed systems to my todos');
    await box.press('Enter');
    const ask = (await sentOf(page, 'pageAsk')).at(-1);
    assert.equal(ask?.prompt, 'Add learn distributed systems to my todos');
    const conversation = {
      id: 'page-thread',
      title: 'Add learn distributed systems',
      agent: 'codex',
      status: 'running',
      startedAt: Date.now() - 3000,
      messages: [
        { id: 'u1', role: 'user', text: 'Add learn distributed systems to my todos' },
        { id: 't1', role: 'tool', text: 'pages_read daily/2026-11-21', status: 'completed' },
        { id: 'a1', role: 'assistant', text: 'I suggested **one to-do** for you to accept.' },
      ],
    };
    const withChat = (status: string, extra = {}) =>
      page.evaluate((value) => window.postMessage({ type: 'page', state: value }, '*'), {
        ...state,
        threads: [
          { id: 'page-thread', title: conversation.title, agent: 'codex', status, updatedAt: 1 },
        ],
        conversation: { ...conversation, status, ...extra },
      });
    await withChat('running');
    const chat = page.getByRole('region', { name: 'Work with this page' });
    await chat.getByText('Add learn distributed systems to my todos').waitFor();
    await chat.locator('strong', { hasText: 'one to-do' }).waitFor();
    await chat.getByRole('button', { name: 'Stop' }).click();
    assert.deepEqual((await sentOf(page, 'pageStop')).at(-1), {
      type: 'pageStop',
      threadId: 'page-thread',
    });
    // A follow-up goes to the same thread.
    await withChat('completed');
    await chat.getByRole('button', { name: 'Send' }).waitFor();
    await box.fill('Also add a table');
    await box.press('Enter');
    assert.deepEqual((await sentOf(page, 'pageReply')).at(-1), {
      type: 'pageReply',
      threadId: 'page-thread',
      prompt: 'Also add a table',
    });
    // Approvals are answered in the Claudex chat, never from the page.
    await withChat('waiting', { waitingFor: 'approval' });
    await chat.getByRole('button', { name: 'Open in chat' }).click();
    assert.deepEqual((await sentOf(page, 'openChat')).at(-1), {
      type: 'openChat',
      id: 'page-thread',
    });
    await page.screenshot({ path: 'test-results/screenshots/page-editor.png' });

    // Diagrams draw, workspace files read as chips, and suggested edits are reviewed in place.
    const review = [
      '# Migration',
      '',
      'Start in `src/webview/app/app.tsx` today.',
      '',
      'The plan is good and short.',
      '',
      '```mermaid',
      'flowchart TD',
      '  A[Adapter] --> B[CLI]',
      '```',
      '',
    ].join('\n');
    await page.evaluate((value) => window.postMessage({ type: 'page', state: value }, '*'), {
      ...state,
      id: 'migration-1a2b3c',
      text: review,
      suggestions: [
        {
          id: 'sug-1',
          pageId: 'migration-1a2b3c',
          agent: 'codex',
          createdAt: 1,
          edits: [{ find: 'is good and short', replace: 'is careful and short' }],
        },
      ],
    });
    await page.locator('.milkdown-code-block .preview .diagram-viewer-stage > svg').waitFor();
    // Crepe re-inserts previews as sanitized markup; the viewer must still be live afterwards.
    const diagramTools = page.locator('.milkdown-code-block .preview .diagram-viewer-tools');
    const diagramZoom = diagramTools.getByRole('button', { name: 'Zoom level; show actual size' });
    const fittedZoom = await diagramZoom.textContent();
    await diagramTools.getByRole('button', { name: 'Zoom in (+)' }).click();
    await page.waitForFunction(
      (before) =>
        document.querySelector('.milkdown-code-block .diagram-viewer-readout')?.textContent !==
        before,
      fittedZoom,
    );
    await diagramTools.getByRole('button', { name: 'Fit (1)' }).click();
    assert.equal(await diagramZoom.textContent(), fittedZoom);
    await page.waitForFunction(() =>
      (window as any).sent.some(
        (m: Sent) =>
          m.type === 'pageResolvePaths' &&
          (m.paths as string[]).includes('src/webview/app/app.tsx'),
      ),
    );
    const check = (await sentOf(page, 'pageResolvePaths')).at(-1);
    await page.evaluate(
      (requestId) =>
        window.postMessage(
          { type: 'pagePathsResolved', requestId, paths: ['src/webview/app/app.tsx'] },
          '*',
        ),
      check?.requestId,
    );
    const chip = page.locator('.page-file-chip', { hasText: 'app.tsx' });
    await chip.waitFor();
    assert.equal(await page.locator('.page-file-dir').first().isVisible(), false);
    await chip.click();
    assert.deepEqual((await sentOf(page, 'link')).at(-1), {
      type: 'link',
      href: 'src/webview/app/app.tsx',
    });
    const bar = page.getByRole('region', { name: 'Suggested changes' });
    await bar.getByText('Codex', { exact: true }).waitFor();
    await page.locator('.page-change-removed', { hasText: 'good' }).waitFor();
    await page.locator('.page-change-added', { hasText: 'careful' }).waitFor();
    await page.getByRole('button', { name: 'Accept Codex’s change' }).click();
    assert.deepEqual((await sentOf(page, 'pageSuggestion')).at(-1), {
      type: 'pageSuggestion',
      id: 'sug-1',
      accept: true,
      index: 0,
    });
    await bar.getByRole('button', { name: 'Reject all' }).click();
    assert.deepEqual((await sentOf(page, 'pageSuggestion')).at(-1), {
      type: 'pageSuggestion',
      id: 'sug-1',
      accept: false,
    });

    // Selected text gets a Notion-like bar; Turn into changes the block.
    await page.locator('.ProseMirror h1', { hasText: 'Migration' }).dblclick();
    const format = page.getByRole('toolbar', { name: 'Format' });
    await format.getByRole('button', { name: /Turn into/ }).click();
    await format.getByRole('button', { name: 'Heading 2' }).click();
    await page.locator('.ProseMirror h2', { hasText: 'Migration' }).waitFor();

    // Ask agent takes a question right in the bar and sends it with the selection.
    await page.locator('.ProseMirror h2', { hasText: 'Migration' }).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await format.getByRole('button', { name: 'Ask agent' }).click();
    const question = page.getByRole('textbox', { name: 'Ask an agent about the selection' });
    await question.fill('Make this a question');
    await question.press('Enter');
    const asked = (await sentOf(page, 'pageAsk')).at(-1);
    assert.match(String(asked?.prompt), /^Make this a question\n\n> Migration/);

    // The chat has no ring around its box and stays pinned to the bottom-right corner.
    await page.setViewportSize({ width: 1100, height: 600 });
    await box.focus();
    assert.equal(await box.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
    const panel = page.locator('.page-chat');
    const corner = async () => {
      const rect = await panel.boundingBox();
      assert.ok(rect && rect.y >= 0, 'the chat is on screen');
      assert.ok(Math.abs(1100 - (rect.x + rect.width) - 16) < 2, 'the chat hugs the right edge');
      assert.ok(Math.abs(600 - (rect.y + rect.height) - 16) < 2, 'the chat hugs the bottom edge');
    };
    await corner();
    // Dragging the header doesn't move it.
    const grip = await page.locator('.page-chat-header').boundingBox();
    assert.ok(grip);
    await page.mouse.move(grip.x + grip.width - 70, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x - 300, grip.y - 150, { steps: 6 });
    await page.mouse.up();
    await corner();
    // Scrolling a long page doesn't move it either.
    await page.locator('.page-scroll').evaluate((element) => element.scrollBy(0, 400));
    await corner();

    // A thread's plan opened as a page: a Build bar like Cursor's, compact tables whose columns
    // you can drag (without touching the Markdown), and a page width you choose.
    await page.setViewportSize({ width: 1400, height: 900 });
    const planText = [
      '# Cache plan',
      '',
      '| Step | Owner | Notes |',
      '| --- | --- | --- |',
      '| Build the index | Codex | Keep `cache.ts` small |',
      '| Ship | Claude | After review |',
      '',
    ].join('\n');
    const plan = {
      threadId: 'plan-thread',
      agentLabel: 'Claude',
      model: 'Opus 5.5',
      status: 'ready',
      manualAllowed: true,
      canBuild: true,
      agent: 'claude',
      profiles: [
        { id: 'claude', label: 'Claude', provider: 'claude', builtin: true },
        { id: 'codex', label: 'Codex', provider: 'codex', builtin: true },
      ],
      catalog: {
        claude: {
          status: 'ready',
          models: [
            { id: 'opus', label: 'Opus 5.5', description: 'Most capable', efforts: ['high'] },
          ],
        },
        codex: {
          status: 'ready',
          models: [
            {
              id: 'gpt-6.2-sol',
              label: 'GPT-6.2 Sol',
              description: 'Frontier model',
              efforts: ['low', 'medium', 'high'],
            },
          ],
        },
      },
    };
    const planState = {
      ...state,
      id: undefined,
      path: 'plans/cache.plan.md',
      text: planText,
      suggestions: [],
      width: 'normal',
      tableWidths: [],
      plan,
    };
    const showPlan = (value: unknown) =>
      page.evaluate((next) => window.postMessage({ type: 'page', state: next }, '*'), value);
    await showPlan(planState);
    const planBar = page.getByRole('region', { name: 'Plan' });
    await planBar.getByText('Ready to build').waitFor();
    // The chat dock's controls: Implement in Auto, with described choices behind the chevron.
    await planBar.getByRole('button', { name: 'Implement in Auto' }).click();
    assert.deepEqual((await sentOf(page, 'pagePlanBuild')).at(-1), {
      type: 'pagePlanBuild',
      threadId: 'plan-thread',
      approvals: 'auto',
    });
    await planBar.getByText('Starting…').waitFor();
    // The host's next state is the truth again.
    await showPlan({ ...planState, plan: { ...plan } });
    await planBar.getByRole('button', { name: 'More ways to continue' }).click();
    await page.getByRole('menuitem', { name: /Approve each edit/ }).waitFor();
    await page.getByRole('menuitem', { name: /Open as text/ }).waitFor();
    await page.getByRole('menuitem', { name: /In a new chat/ }).click();
    // A new chat picks its agent and model with the chat's own model picker.
    await planBar.getByRole('button', { name: /^Model: Claude/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    await picker.getByRole('tablist', { name: 'Agents' }).waitFor();
    assert.equal(await picker.getByText('Add account').count(), 0, 'no account links on a page');
    await picker.getByRole('tab', { name: 'Codex' }).click();
    await picker.getByRole('option', { name: /GPT-6\.2 Sol/ }).click();
    await planBar.getByRole('button', { name: /^Effort:/ }).waitFor();
    await page.screenshot({ path: 'test-results/screenshots/page-plan-new-chat.png' });
    await planBar.getByRole('button', { name: /Start in Auto/ }).click();
    assert.deepEqual((await sentOf(page, 'pagePlanBuild')).at(-1), {
      type: 'pagePlanBuild',
      threadId: 'plan-thread',
      agent: 'codex',
      model: 'gpt-6.2-sol',
    });
    await showPlan({ ...planState, plan: { ...plan } });
    // Esc goes back to the plan's own choices.
    await planBar.getByRole('button', { name: 'Back to plan choices' }).focus();
    await page.keyboard.press('Escape');
    await planBar.getByRole('button', { name: 'Implement in Auto' }).waitFor();
    await showPlan({ ...planState, plan: { ...plan, status: 'approved', canBuild: false } });
    await planBar.getByText('Built').waitFor();
    assert.equal(await planBar.getByRole('button', { name: 'Implement in Auto' }).count(), 0);

    // Table text is compact; body text keeps its size.
    const cell = page.locator('.milkdown-table-block td p', { hasText: 'Build the index' });
    await cell.waitFor();
    assert.equal(await cell.evaluate((element) => getComputedStyle(element).fontSize), '13px');
    // Dragging a column's edge widens it and reports the width; the Markdown is unchanged.
    const edits = (await sentOf(page, 'pageEdit')).length;
    const header = page.locator('.milkdown-table-block th').first();
    const before = await header.boundingBox();
    assert.ok(before);
    await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width + 80, before.y + before.height / 2, { steps: 5 });
    await page.mouse.up();
    const widths = (await sentOf(page, 'pageTableWidths')).at(-1)?.widths as number[][];
    assert.ok(
      widths?.[0]?.[0] > before.width + 40,
      `the column widened: ${JSON.stringify(widths)}`,
    );
    const after = await header.boundingBox();
    assert.ok(after && after.width > before.width + 40, 'the drawn column is wider');
    assert.equal((await sentOf(page, 'pageEdit')).length, edits, 'the Markdown is untouched');
    await page.screenshot({ path: 'test-results/screenshots/plan-page.png' });

    // Every page leads back to All pages.
    await page.getByRole('button', { name: 'All pages' }).click();
    assert.deepEqual((await sentOf(page, 'pageAllPages')).at(-1), { type: 'pageAllPages' });
    // The page grows with a wide editor, and Full width is one choice for every page.
    const column = page.locator('.page-column');
    const normal = await column.evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(normal > 740, `a wide editor gets a wider page (${normal}px)`);
    await page.getByRole('button', { name: 'Full width' }).click();
    assert.deepEqual((await sentOf(page, 'pageWidth')).at(-1), {
      type: 'pageWidth',
      width: 'full',
    });
    await showPlan({ ...planState, width: 'full', tableWidths: widths });
    await page.getByRole('button', { name: 'Normal width' }).waitFor();
    const full = await column.evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(full > normal + 200, `full width fills the editor (${full}px)`);

    // Saved widths from a wide editor must leave room for automatic columns in a narrow editor.
    await page.setViewportSize({ width: 560, height: 900 });
    await showPlan({ ...planState, width: 'full', tableWidths: [[0, 400, 560]] });
    const table = page.locator('.milkdown-table-block table.children');
    await table.locator('th[style*="400px"]').waitFor();
    const firstColumn = await table.locator('td').first().boundingBox();
    assert.ok(firstColumn && firstColumn.width >= 70, 'the automatic first column has room');
    const wrapper = table.locator('..');
    const scroll = await wrapper.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft;
    });
    assert.ok(scroll > 0, 'the wide table can scroll within the editor');
    assert.equal(
      await page
        .locator('.page-scroll')
        .evaluate((element) => element.scrollWidth - element.clientWidth),
      0,
      'the table does not widen the page',
    );

    // Images sit on the text's left edge, and the side handles set a width the Markdown keeps.
    await page.setViewportSize({ width: 1280, height: 900 });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1200"><rect width="2400" height="1200" fill="#4a6"/></svg>';
    const picture = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await showPlan({
      ...state,
      id: 'image-page',
      text: `Before the picture\n\n![1.00](${picture})\n`,
      width: 'normal',
    });
    const image = page.locator('.page-image');
    const frame = image.locator('.page-image-frame');
    await frame.locator('img').waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.page-image img');
      return Boolean(img?.complete && img.naturalWidth);
    });
    const text = await page
      .locator('.ProseMirror p', { hasText: 'Before the picture' })
      .evaluate((element) => element.getBoundingClientRect().left);
    const start = await frame.boundingBox();
    const prose = await page.locator('.milkdown .ProseMirror').boundingBox();
    assert.ok(start && prose);
    assert.ok(
      Math.abs(start.x - text) < 1,
      `the image lines up with the text (${start.x}, ${text})`,
    );
    assert.ok(Math.abs(start.width - prose.width) < 2, 'a large image fills the page column');
    await frame.hover();
    const handle = await image.locator('.page-image-handle.is-right').boundingBox();
    assert.ok(handle);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - start.width / 2, handle.y + handle.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() =>
      /!\[0\.[4-5]\d\]\(data:image/.test(
        (window as any).sent.filter((m: Sent) => m.type === 'pageEdit').at(-1)?.text ?? '',
      ),
    );
    const resized = await frame.boundingBox();
    assert.ok(resized && resized.width < start.width * 0.6, 'the image is narrower');
    assert.ok(Math.abs(resized.x - text) < 1, 'a narrower image stays on the left edge');
    // Full size opens over the page and Esc closes it.
    await frame.dblclick();
    await page.locator('.page-image-viewer img').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.page-image-viewer').waitFor({ state: 'detached' });
    await page.screenshot({ path: 'test-results/screenshots/page-image.png' });

    assert.deepEqual(errors, [], 'the page editor loads cleanly under the policy');
  } finally {
    await page.close();
  }
}
