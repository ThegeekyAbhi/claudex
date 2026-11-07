import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

/** A finished thread reads as question, one line of work, then the answer. */
export async function checkReading(ctx: UiCheckContext): Promise<void> {
  const { page, snapshot, update } = ctx;
  const base = snapshot.sessions.find((item) => item.id === 'planned') as unknown as Session;
  const long =
    'This paragraph is long on purpose, so the check can see that a reply stops at a comfortable line length instead of running the whole width of a wide window, which is what made replies feel like a wall of text to read.';
  const at = Date.parse('2026-11-07T10:00:00Z');
  const thread = {
    ...base,
    id: 'reading',
    title: 'Readable thread',
    status: 'completed',
    approval: undefined,
    plan: undefined,
    parentId: undefined,
    messages: [
      { id: 'r-q', role: 'user', text: 'Does it work on Linux?', startedAt: at },
      { id: 'r-n1', role: 'assistant', text: 'Checking the cache first.', startedAt: at + 1_000 },
      {
        id: 'r-s1',
        role: 'tool',
        text: '',
        startedAt: at + 2_000,
        tool: { kind: 'command', name: 'command', title: 'pnpm check', status: 'completed' },
      },
      {
        id: 'r-e1',
        role: 'tool',
        text: '',
        startedAt: at + 20_000,
        tool: {
          kind: 'edit',
          name: 'Edit',
          title: 'src/compiler.ts',
          status: 'completed',
          diffs: [
            {
              path: 'src/compiler.ts',
              kind: 'update',
              patch:
                "@@ -18,3 +18,3 @@\n const limit = 40;\n-const cache = new Map();\n+const cache = new Map<string, Plan>();\n // keep it 'warm'",
              additions: 1,
              deletions: 1,
            },
          ],
        },
      },
      { id: 'r-n2', role: 'assistant', text: 'Now the shortcut labels.', startedAt: at + 30_000 },
      {
        id: 'r-s2',
        role: 'tool',
        text: '',
        startedAt: at + 31_000,
        tool: { kind: 'command', name: 'command', title: 'grep kbd', status: 'completed' },
      },
      {
        id: 'r-a',
        role: 'assistant',
        text: `Yes, it should work on **Linux**. Run \`pnpm check\` to see.\n\n${long}\n\n\`\`\`sh\npnpm test:ui\n\`\`\`\n\n\`\`\`ts\nimport { open } from 'node:fs/promises';\nexport const limit = 40; // lines\n\`\`\``,
        startedAt: at + 63_000,
      },
      { id: 'terminal-run-1', role: 'notice', text: 'From the terminal: 1 message.' },
      { id: 'r-q2', role: 'user', text: 'Thanks', startedAt: at + 90_000 },
      { id: 'r-a2', role: 'assistant', text: 'Glad to help.', startedAt: at + 91_000 },
    ],
  };
  (snapshot.sessions as unknown as Session[]).push(thread as unknown as Session);
  await update('reading');
  const main = page.locator('.main');
  await main.getByText('Glad to help.').waitFor();

  // Your message is a bubble on the right, narrower than the column.
  const bubble = await main
    .locator('.user-message .bubble')
    .first()
    .evaluate((element) => {
      const own = element.getBoundingClientRect();
      const column = (element.closest('.user-message') as Element).getBoundingClientRect();
      return { right: column.right - own.right, inset: own.left - column.left };
    });
  assert.ok(bubble.right < 2, `your message sits on the right (${bubble.right}px from the edge)`);
  assert.ok(bubble.inset > 100, 'your message is narrower than the column');

  // The finished turn's work is one line; the answer and edits stay in view.
  const work = main.getByRole('button', { name: /^Worked 1m 2s · .*ran 2 commands/ });
  await work.waitFor();
  assert.equal(await work.getAttribute('aria-expanded'), 'false');
  assert.equal(await main.getByText('Checking the cache first.').count(), 0, 'notes fold away');
  await main.getByText('Yes, it should work on').waitFor();
  await page.screenshot({ path: 'test-results/screenshots/reading-folded.png' });
  await work.click();
  await main.getByText('Checking the cache first.').waitFor();
  const note = await main
    .getByText('Checking the cache first.')
    .evaluate((element) => element.closest('.markdown')?.classList.contains('note'));
  assert.equal(note, true, 'an opened note reads quieter than the answer');
  await page.screenshot({ path: 'test-results/screenshots/reading-open.png' });
  await work.click();

  // The last turn has a single reply, so nothing folds there.
  assert.equal(await main.getByRole('button', { name: /^Worked/ }).count(), 1);

  // Inline code keeps the text's colour, not VS Code's teal.
  const colours = await main
    .locator('.markdown.reply code')
    .first()
    .evaluate((element) => ({
      code: getComputedStyle(element).color,
      text: getComputedStyle(element.parentElement as Element).color,
    }));
  assert.equal(colours.code, colours.text, 'inline code is the colour of its sentence');

  // Code reads in VS Code's Dark+ colours: keywords, strings and comments each their own.
  const tokenColour = (scope: string, text: string) =>
    main
      .locator(`${scope} .tok`, { hasText: text })
      .first()
      .evaluate((element) => getComputedStyle(element).color);
  const block = '.markdown.reply pre';
  const dark = {
    keyword: await tokenColour(block, 'import'),
    string: await tokenColour(block, "'node:fs/promises'"),
    comment: await tokenColour(block, '// lines'),
    text: await main
      .locator(block, { hasText: 'node:fs' })
      .evaluate((element) => getComputedStyle(element).color),
  };
  assert.equal(dark.keyword, 'rgb(197, 134, 192)', 'a keyword is Dark+ purple');
  assert.equal(dark.string, 'rgb(206, 145, 120)', 'a string is Dark+ orange');
  assert.equal(dark.comment, 'rgb(106, 153, 85)', 'a comment is Dark+ green');
  assert.notEqual(dark.keyword, dark.text, 'code is not one flat colour');
  // A diff is coloured too, over its added and removed backgrounds.
  const diffComment = await tokenColour('.diff-line', "keep it 'warm'");
  assert.equal(diffComment, 'rgb(106, 153, 85)', 'a comment in a diff is coloured');
  const added = main.locator('.diff-line.add', { hasText: 'Map<string, Plan>' }).first();
  assert.ok((await added.locator('.tok').count()) > 1, 'an added line is coloured, not plain text');
  assert.notEqual(
    await added.evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgba(0, 0, 0, 0)',
    'an added line keeps its background',
  );
  await page.screenshot({ path: 'test-results/screenshots/code-dark.png' });
  // High contrast keeps plain text: the theme has already made it readable.
  const theme = await page.evaluate(() => document.body.className);
  await page.evaluate(() => {
    document.body.className = 'vscode-high-contrast';
  });
  assert.equal(
    await tokenColour(block, 'import'),
    await main
      .locator(block, { hasText: 'node:fs' })
      .evaluate((element) => getComputedStyle(element).color),
    'high contrast code uses the text colour',
  );
  await page.screenshot({ path: 'test-results/screenshots/code-high-contrast.png' });
  await page.evaluate((name) => {
    document.body.className = name;
  }, theme);

  // Prose stops at a reading width; a code block still uses the column.
  const widths = await main.getByText(long).evaluate((element) => {
    const reply = element.closest('.markdown') as Element;
    // The code block as the reply lays it out: its top-level wrapper.
    let pre = reply.querySelector('pre') as Element;
    while (pre.parentElement && pre.parentElement !== reply) pre = pre.parentElement;
    return {
      prose: element.getBoundingClientRect().width,
      code: pre.getBoundingClientRect().width,
      column: reply.getBoundingClientRect().width,
    };
  });
  assert.ok(
    widths.prose < widths.column - 100,
    `prose is narrower than the column (${widths.prose})`,
  );
  assert.ok(widths.code > widths.column - 2, 'a code block spans the column');

  // Rows read from a terminal start under a quiet divider.
  await main.locator('.terminal-divider', { hasText: 'From the terminal' }).waitFor();

  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await frame();
    await page.screenshot({ path: `test-results/screenshots/reading-${width}.png` });
  }
  // A light theme, as VS Code's Light Modern sets it.
  await page.evaluate(() => {
    document.body.className = 'vscode-light';
    document.body.style.setProperty('--vscode-editor-background', '#ffffff');
    document.body.style.setProperty('--vscode-foreground', '#3b3b3b');
    document.body.style.setProperty('--vscode-input-background', '#ffffff');
    document.body.style.setProperty('--vscode-button-background', '#005fb8');
  });
  await frame();
  await page.screenshot({ path: 'test-results/screenshots/reading-light.png' });
  assert.equal(
    await tokenColour(block, 'import'),
    'rgb(175, 0, 219)',
    'a keyword is Light+ purple',
  );
  assert.equal(
    await tokenColour(block, "'node:fs/promises'"),
    'rgb(163, 21, 21)',
    'a string is Light+ red',
  );
  await page.evaluate((name) => {
    document.body.className = name;
    for (const key of ['editor-background', 'foreground', 'input-background', 'button-background'])
      document.body.style.removeProperty(`--vscode-${key}`);
  }, theme);
  // A long thread scrolls only inside the conversation, never the page around it.
  await page.setViewportSize({ width: 1024, height: 760 });
  const chatty = {
    ...thread,
    id: 'chatty',
    title: 'Chatty thread',
    messages: Array.from({ length: 45 }, (_, index) => [
      { id: `c-q${index}`, role: 'user', text: `Question ${index}`, startedAt: at + index * 2 },
      {
        id: `c-a${index}`,
        role: 'assistant',
        text: `Answer ${index}`,
        startedAt: at + index * 2 + 1,
      },
    ]).flat(),
  };
  (snapshot.sessions as unknown as Session[]).push(chatty as unknown as Session);
  await update('chatty');
  await main.getByText('Answer 44', { exact: true }).waitFor();
  const overflowing = await page.evaluate(() => {
    const scroller = document.querySelector('.main .conversation-scroll');
    const found: string[] = [];
    // Every box around the conversation, up to the page itself.
    for (let element = scroller?.parentElement; element; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight + 1)
        found.push(
          `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 50)} ${element.scrollHeight}/${element.clientHeight}`,
        );
    }
    return { found, scroller: Boolean(scroller) };
  });
  assert.ok(overflowing.scroller, 'the conversation has its scroller');
  assert.deepEqual(overflowing.found, [], 'nothing outside the conversation scrolls');
  snapshot.sessions.splice(snapshot.sessions.indexOf(chatty as never), 1);

  // Later sections continue from the planned thread.
  snapshot.sessions.splice(snapshot.sessions.indexOf(thread as never), 1);
  await update('planned');
}
