import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const preview = spawn(process.execPath, ['scripts/preview.mjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((resolve, reject) => {
  preview.stdout.once('data', () => resolve());
  preview.once('error', reject);
  preview.once('exit', (code) => reject(new Error(`Preview exited: ${code}`)));
});
const cached = path.join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(cached) ? cached : undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/Content Security Policy/i.test(message.text())) errors.push(message.text());
});
await mkdir('docs/screenshots', { recursive: true });
try {
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: /^Model: Codex/ }).waitFor();
  await page.addInitScript({
    content: `
    window.sent = [];
    window.acquireVsCodeApi = () => ({
      getState: () => undefined, setState: () => {},
      postMessage: message => window.sent.push(message)
    });
  `,
  });
  await page.reload();
  await page.waitForFunction(() =>
    (window as any).sent?.some((message: any) => message.type === 'ready'),
  );
  const sentOf = (type: string) =>
    page.evaluate(
      (kind) => (window as any).sent.filter((message: any) => message.type === kind),
      type,
    );
  const catalog = {
    codex: {
      status: 'ready',
      models: [
        {
          id: 'gpt-6.1-sol',
          label: 'GPT-6.1-Sol',
          description: 'Latest workhorse model for coding and everyday work.',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          isDefault: true,
        },
        {
          id: 'gpt-6-luna',
          label: 'GPT-6-Luna',
          description: 'Fast and affordable model for easier tasks.',
          efforts: ['low', 'medium'],
        },
      ],
    },
    claude: {
      status: 'ready',
      models: [
        {
          id: 'opus',
          label: 'Opus 5.5',
          description: 'For complex work and everyday tasks',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          id: 'sonnet',
          label: 'Sonnet 5.5',
          description: 'Most efficient for simpler tasks',
          efforts: ['low', 'medium', 'high'],
        },
        {
          id: 'claude-opus-4-8',
          label: 'Opus 4.8',
          description: 'Best for everyday, complex tasks',
          efforts: ['low', 'medium'],
        },
      ],
    },
    claud2: { status: 'error', models: [], error: 'spawn claud2 ENOENT' },
  };
  const patch =
    '@@ -18,5 +18,6 @@\n const limit = 40;\n-const cache = new Map();\n+const cache = new Map<string, Plan>();\n+const seen = new Set<string>();\n compile(plan);';
  const snapshot = {
    project: 'studio',
    trusted: true,
    catalog,
    documents: [
      { path: 'docs/agent-work/render-plan.md', name: 'render-plan.md' },
      { path: 'docs/agent-work/compiler-task.md', name: 'compiler-task.md' },
    ],
    sessions: [
      {
        id: 'codex-one',
        title: 'Render pipeline review',
        provider: 'codex',
        cwd: '/Projects/studio',
        workspace: '/Projects/studio',
        status: 'waiting',
        model: 'gpt-6.1-sol',
        effort: 'high',
        createdAt: 1,
        updatedAt: Date.now() - 600_000,
        messages: [
          {
            id: 'u',
            role: 'user',
            text: 'Review the render plan, then ask Claude to double-check the compiler.',
          },
          {
            id: 'th',
            role: 'thinking',
            text: 'The compiler caches plans by **path**, so a renamed clip could reuse a stale entry.',
            startedAt: 1000,
            endedAt: 5000,
          },
          {
            id: 't1',
            role: 'tool',
            text: 'tests 27\npass 27',
            tool: {
              kind: 'command',
              name: 'command',
              title: 'pnpm test --filter compiler',
              status: 'completed',
              durationMs: 4200,
            },
          },
          {
            id: 't2',
            role: 'tool',
            text: '',
            tool: { kind: 'read', name: 'Read', title: 'src/compiler.ts', status: 'completed' },
          },
          {
            id: 't3',
            role: 'tool',
            text: 'exit 1',
            tool: {
              kind: 'command',
              name: 'command',
              title: 'pnpm lint',
              status: 'failed',
            },
          },
          {
            id: 't4',
            role: 'tool',
            text: '',
            tool: {
              kind: 'edit',
              name: 'Edit',
              title: 'src/compiler.ts',
              status: 'completed',
              diffs: [
                {
                  path: 'src/compiler.ts',
                  kind: 'update',
                  patch,
                  additions: 2,
                  deletions: 1,
                },
              ],
            },
          },
          {
            id: 'a',
            role: 'assistant',
            text: 'The cache is keyed too loosely, so I fixed that. Next milestone:\n\n- Validate render contracts\n- Implement the plan compiler\n\nThe brief is in `docs/agent-work/`.',
          },
          {
            id: 'sub',
            role: 'tool',
            text: '',
            tool: {
              kind: 'agent',
              name: 'run_agent',
              title: 'Double-check the compiler',
              status: 'running',
              workerId: 'delegate',
            },
          },
          {
            id: 'sub2',
            role: 'tool',
            text: '',
            tool: {
              kind: 'agent',
              name: 'delegate',
              title: 'Write release notes',
              status: 'completed',
              workerId: 'delegate-done',
            },
          },
        ],
        approval: {
          id: 'approval-one',
          title: 'Run Claude agent?',
          detail: 'Double-check the plan compiler cache key.',
        },
      },
      {
        id: 'delegate',
        title: 'Double-check the compiler',
        provider: 'claude',
        claudeCommand: 'claude',
        cwd: '/Projects/studio',
        workspace: '/Projects/studio',
        parentId: 'codex-one',
        delegated: true,
        status: 'running',
        model: 'sonnet',
        createdAt: 2,
        updatedAt: Date.now(),
        messages: [
          {
            id: 'd1',
            role: 'tool',
            text: '',
            tool: { kind: 'search', name: 'Grep', title: 'planCache', status: 'running' },
          },
        ],
      },
      {
        id: 'delegate-done',
        title: 'Write release notes',
        provider: 'codex',
        cwd: '/Projects/studio',
        workspace: '/Projects/studio',
        parentId: 'codex-one',
        delegated: true,
        status: 'completed',
        createdAt: Date.now() - 90_000,
        updatedAt: Date.now() - 20_000,
        messages: [{ id: 'd2', role: 'assistant', text: 'Release notes are ready for review.' }],
      },
      {
        id: 'claude-two',
        title: 'Playback review',
        provider: 'claude',
        cwd: '/Projects/studio-agent-worktrees/playback',
        workspace: '/Projects/studio',
        status: 'idle',
        createdAt: 2,
        updatedAt: Date.now() - 7_200_000,
        messages: [],
      },
      {
        id: 'worker',
        title: 'Plan compiler',
        provider: 'codex',
        cwd: '/Projects/studio',
        workspace: '/Projects/studio',
        status: 'running',
        parentId: 'codex-one',
        observed: true,
        createdAt: 3,
        updatedAt: 3,
        messages: [],
      },
    ],
  };
  async function update(selectedId?: string) {
    await page.evaluate(
      ({ snapshot, selectedId }) =>
        window.postMessage(
          { type: 'snapshot', snapshot, selectedId, imageBase: '/fixture-images' },
          '*',
        ),
      { snapshot, selectedId },
    );
    const expected = snapshot.sessions.find((session) => session.id === selectedId)?.title;
    if (!expected) return;
    await page.waitForFunction(
      (title) => document.querySelector('.session-name')?.textContent?.trim() === title,
      expected,
    );
  }
  const box = page.getByRole('textbox', { name: 'Message your agent' });

  // The panel fills the webview despite VS Code's injected body padding, with a left divider.
  const frame = await page.evaluate(() => ({
    padding: getComputedStyle(document.body).paddingLeft,
    left: document.querySelector('.workspace')?.getBoundingClientRect().left,
    border: getComputedStyle(document.querySelector('.workspace') as Element).borderLeftWidth,
    font: document.fonts.check('13px "Inter Variable"'),
  }));
  assert.deepEqual(frame, { padding: '0px', left: 0, border: '1px', font: true });

  // A new thread asks nothing: pick an agent and model in place, type, press Enter.
  await update(undefined);
  await page.getByRole('button', { name: /^Model: Codex/ }).waitFor();
  await page.getByRole('button', { name: /^Model:/ }).click();
  const rail = page.getByRole('tablist', { name: 'Agents' });
  assert.deepEqual(
    await rail
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))),
    ['Claude', 'Claude 2', 'Codex'],
    'providers are listed in the requested order',
  );
  await page.getByRole('option', { name: 'GPT-6.1-Sol' }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'Sonnet 5.5' }).count(), 0);
  await page.screenshot({ path: 'docs/screenshots/model-selector.png' });
  // Choosing a provider on the left shows its models on the right, by mouse or arrow key.
  await rail.getByRole('tab', { name: 'Claude', exact: true }).click();
  await page.getByRole('option', { name: 'Sonnet 5.5' }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'GPT-6.1-Sol' }).count(), 0);
  // Older versions wait behind More models.
  assert.equal(await page.getByRole('option', { name: 'Opus 4.8' }).count(), 0);
  await page.getByRole('option', { name: /More models/ }).click();
  // The highlight moves to the first revealed row, and the footer describes that row.
  await page.getByRole('option', { name: 'Opus 4.8', selected: true }).waitFor();
  await page.locator('.menu-footer').getByText('Best for everyday, complex tasks').waitFor();
  await page.screenshot({ path: 'docs/screenshots/model-selector-claude.png' });
  const search = page.getByRole('combobox');
  await search.focus();
  await search.press('ArrowRight');
  await rail.getByRole('tab', { name: 'Claude 2', exact: true, selected: true }).waitFor();
  assert.ok(
    await rail.getByText('Claude 2').evaluate((label) => label.scrollWidth <= label.clientWidth),
    'provider names are not cut off in the editor layout',
  );
  await page.getByText('Could not read this CLI’s models.').waitFor();
  await search.press('ArrowLeft');
  await rail.getByRole('tab', { name: 'Claude', exact: true, selected: true }).waitFor();
  // Search looks across every agent, including older versions.
  await search.fill('opus 4');
  await page.getByRole('option', { name: 'Opus 4.8' }).waitFor();
  await search.fill('sonnet');
  await page.screenshot({ path: 'docs/screenshots/model-selector-search.png' });
  assert.equal(await page.getByRole('option').count(), 1, 'search filters across agents');
  await search.press('Enter');
  await page.getByRole('button', { name: /^Model: Claude Sonnet/ }).waitFor();
  // Effort lives in the model menu, for the model that is chosen.
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page
    .getByRole('group', { name: 'Reasoning effort' })
    .getByRole('button', { name: 'High' })
    .click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model: Claude Sonnet 5.5, high effort/ }).waitFor();
  await box.fill('Fix the login bug');
  await box.press('Shift+Enter');
  assert.equal((await sentOf('start')).length, 0, 'Shift+Enter is a new line');
  await box.fill('Fix the login bug');
  await box.press('Enter');
  const [started] = await sentOf('start');
  assert.deepEqual(
    [started.agent, started.model, started.effort, started.text, started.worktree],
    ['claude', 'sonnet', 'high', 'Fix the login bug', undefined],
  );
  // The first message is held until the host confirms it, so a failure cannot lose the draft.
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Fix the login bug' }, '*'),
    started.draftKey,
  );

  // Worktrees are opt-in, offered as a choice next to the model.
  await page.getByRole('button', { name: /^Location/ }).click();
  await page.getByRole('menuitemradio', { name: /New worktree/ }).click();
  await box.fill('@codex Try it in isolation');
  await box.press('Enter');
  const [, mentioned] = await sentOf('start');
  assert.deepEqual(
    [mentioned.agent, mentioned.text, mentioned.worktree],
    ['codex', 'Try it in isolation', true],
  );
  // A background update during a slow start must not allow a duplicate start.
  await update(undefined);
  await box.press('Enter');
  assert.equal((await sentOf('start')).length, 2, 'Enter while starting does not start twice');
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Try it in isolation' }, '*'),
    mentioned.draftKey,
  );
  // The worktree choice applied to that thread only.
  await page.getByRole('button', { name: 'Location: local checkout' }).waitFor();

  // A thread shows thinking, steps, visible diffs, and child threads.
  await update('codex-one');
  await page.getByRole('heading', { name: 'Run Claude agent?' }).waitFor();
  await page.getByRole('region', { name: 'Changes to src/compiler.ts' }).waitFor();
  assert.ok(await page.locator('.diff-line.add').first().isVisible(), 'diffs show by default');
  await page.getByRole('button', { name: /Edited 1 file, ran 2 commands, read 1 file/ }).click();
  await page.getByRole('button', { name: 'Thought for 4s' }).click();
  await page.getByText('so a renamed clip could reuse').waitFor();
  await page.getByText('Failed: running').waitFor();
  await page.screenshot({ path: 'docs/screenshots/conversation.png' });
  await page.getByRole('button', { name: 'Allow once' }).click();
  const [approval] = await sentOf('approve');
  assert.deepEqual([approval.id, approval.allowed], ['codex-one', true]);

  // Questions dock on the composer, one at a time, and answer from the keyboard.
  snapshot.sessions.push({
    id: 'asking',
    title: 'Choose the release',
    provider: 'codex',
    cwd: '/Projects/studio',
    workspace: '/Projects/studio',
    status: 'waiting',
    createdAt: 8,
    updatedAt: Date.now(),
    usage: {
      context: { used: 176_000, max: 200_000 },
      limits: [
        { id: 'primary', label: '5-hour', usedPercent: 31, resetsAt: Date.now() + 8_000_000 },
        { id: 'secondary', label: 'Weekly', usedPercent: 12, resetsAt: Date.now() + 400_000_000 },
        { id: 'stale', label: 'Expired', usedPercent: 99, resetsAt: Date.now() - 1000 },
      ],
      updatedAt: Date.now() - 120_000,
    },
    approval: {
      id: 'q-1',
      title: 'Your input is needed',
      detail: '',
      questions: [
        {
          id: 'lead',
          prompt: 'Which outcome should lead the first release?',
          options: ['Skills and context (Recommended)', 'Long-running reliability', 'UI redesign'],
          details: { 'Long-running reliability': 'Fewer stalled turns' },
        },
        {
          id: 'problem',
          prompt: 'What describes the skills problem?',
          options: ['Hard to discover', 'Agent ignores skills'],
          multiple: true,
        },
        { id: 'note', prompt: 'Anything else?', options: [] },
      ],
    },
    messages: [{ id: 'au', role: 'user', text: 'Plan the release' }],
  } as unknown as (typeof snapshot.sessions)[number]);
  await update('asking');
  const questionCard = page.getByRole('region', { name: 'Agent questions' });
  await questionCard.getByText('1 of 3').waitFor();
  // An empty composer gives the keyboard to the questions.
  // Polled from here because the page's CSP rules out waitForFunction's eval.
  await assert.doesNotReject(async () => {
    for (let tries = 0; tries < 40; tries++) {
      const focused = await questionCard.evaluate((card) => card.contains(document.activeElement));
      if (focused) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('The question card did not take focus.');
  });
  await questionCard.getByText('Recommended', { exact: true }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/questions.png' });
  const continueButton = questionCard.getByRole('button', { name: /Continue/ });
  assert.equal(await continueButton.isDisabled(), true, 'an answer is needed to move on');
  await page.keyboard.press('b');
  assert.equal(
    await questionCard.getByRole('radio', { name: /Long-running/ }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Enter');
  await questionCard.getByText('2 of 3').waitFor();
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await questionCard.getByText('3 of 3').waitFor();
  await questionCard.getByRole('textbox').fill('Ship it');
  await questionCard.getByRole('textbox').press('Enter');
  const [answered] = (await sentOf('approve')).filter((item: any) => item.requestId === 'q-1');
  assert.deepEqual(answered.answers, {
    lead: 'Long-running reliability',
    problem: 'Hard to discover, Agent ignores skills',
    note: 'Ship it',
  });
  // Esc tells the agent you declined, and reports no answers.
  await update(undefined);
  await update('asking');
  await questionCard.getByText('1 of 3').waitFor();
  await questionCard.focus();
  await page.keyboard.press('Escape');
  const skipped = (await sentOf('approve')).filter((item: any) => item.requestId === 'q-1').at(-1);
  assert.deepEqual([skipped.allowed, skipped.answers], [false, {}]);
  // Usage: a quiet ring with the CLI's own numbers, and a way forward when nearly full.
  const ring = page.getByRole('button', { name: 'Context 88% used' });
  await ring.hover();
  const usageCard = page.getByRole('dialog', { name: 'Usage' });
  await usageCard.getByText('176K of 200K tokens').waitFor();
  await usageCard.getByText('Weekly limit').waitFor();
  assert.equal(await usageCard.getByText('Expired').count(), 0, 'an elapsed window is not shown');
  await usageCard.getByRole('button', { name: 'Hand off to another agent' }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/usage.png' });
  await page.mouse.move(0, 0);
  await usageCard.waitFor({ state: 'detached' });
  await update('codex-one');

  // Child threads: inline, and nested in the sidebar with a working rail.
  const nav = page.getByRole('navigation', { name: 'Agent sessions' });
  await nav.getByRole('button', { name: 'Double-check the compiler' }).waitFor();
  await page.getByText('planCache').waitFor();
  await page.getByText('Release notes are ready for review.').waitFor();
  await page.getByRole('button', { name: 'Add this result to your next message' }).waitFor();

  // An agent can be run from the composer without leaving the thread.
  await box.fill('@cl');
  await page.getByRole('option', { name: /@claude2/ }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/mention.png' });
  await box.press('ArrowDown');
  await box.press('Enter');
  assert.equal(await box.inputValue(), '@claude2 ');
  await box.fill('@codex Write the migration');
  await page.getByRole('button', { name: 'Send message' }).click();
  const [delegated] = await sentOf('delegate');
  assert.deepEqual(
    [delegated.id, delegated.agent, delegated.text],
    ['codex-one', 'codex', 'Write the migration'],
  );
  await box.fill('');

  // Model changes on a started thread update it; another agent opens a new thread with the draft.
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('option', { name: 'GPT-6-Luna' }).click();
  const [changed] = await sentOf('setModel');
  assert.deepEqual([changed.id, changed.model, changed.effort], ['codex-one', 'gpt-6-luna', null]);

  // Per-thread drafts survive switching.
  await box.fill('Draft for Codex');
  await update('claude-two');
  await box.fill('Draft for Claude');
  await update('codex-one');
  assert.equal(await box.inputValue(), 'Draft for Codex');
  await update('claude-two');
  await box.press('Meta+Enter');
  const [sentMessage] = await sentOf('send');
  assert.deepEqual([sentMessage.id, sentMessage.text], ['claude-two', 'Draft for Claude']);

  await update('worker');
  await page.getByText('manages this worker from its lead thread').waitFor();
  assert.equal(await box.count(), 0);

  // The changes panel reads the checkout and shows what is really there.
  await update('codex-one');
  await page.getByRole('button', { name: 'Toggle changes' }).click();
  await page.waitForFunction(() =>
    (window as any).sent.some((message: any) => message.type === 'changes'),
  );
  await page.evaluate(
    ({ patch }) =>
      window.postMessage(
        {
          type: 'changes',
          id: 'codex-one',
          result: {
            files: [
              { path: 'src/compiler.ts', kind: 'update', patch, additions: 2, deletions: 1 },
              {
                path: 'src/plan.ts',
                kind: 'add',
                patch: '@@ -0,0 +1,1 @@\n+export {};',
                additions: 1,
                deletions: 0,
              },
            ],
          },
        },
        '*',
      ),
    { patch },
  );
  await page.getByRole('complementary').getByText('2 files').waitFor();
  await page.screenshot({ path: 'docs/screenshots/changes-panel.png' });
  await page
    .getByRole('button', { name: 'Open src/compiler.ts in the diff editor' })
    .last()
    .click();
  const [opened] = await sentOf('openDiff');
  assert.equal(opened.file, 'src/compiler.ts');
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Icon buttons explain themselves.
  await page.getByRole('button', { name: 'Toggle changes' }).hover();
  await page.getByRole('tooltip').waitFor();
  await page.mouse.move(0, 0);

  // Modes: Shift+Tab toggles, and a new thread starts in the chosen mode.
  await update(undefined);
  await box.fill('Plan the render cache');
  await box.press('Shift+Tab');
  await page.getByRole('button', { name: 'Mode: Plan' }).waitFor();
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
  await page.getByRole('menuitemradio', { name: /Agent/ }).click();

  // A plan is pinned above the thread, with rich Markdown and an honest state.
  const planText = [
    '# Render cache',
    '> [!WARNING]\n> Old keys must not be reused.',
    '## Steps',
    '- [x] Read `src/compiler.ts`',
    '- [ ] Change the key',
    '| File | Lines |\n| --- | --- |\n| compiler.ts | 12 |',
    '## Code',
    '```ts\nconst cache = new Map<string, Plan>(); // keyed by id\n```',
    '## Tests',
    'Run the suite.',
  ].join('\n\n');
  snapshot.sessions.push({
    id: 'planned',
    title: 'Plan the cache',
    provider: 'claude',
    claudeCommand: 'claude',
    cwd: '/Projects/studio',
    workspace: '/Projects/studio',
    status: 'waiting',
    mode: 'plan',
    createdAt: 9,
    updatedAt: Date.now(),
    plan: { text: planText, status: 'ready', updatedAt: Date.now() },
    approval: { id: 'plan-1', title: 'Build this plan?', detail: '', kind: 'plan' },
    messages: [
      {
        id: 'pu',
        role: 'user',
        text: 'Plan the cache',
        attachments: [
          { kind: 'file', path: 'src/compiler.ts' },
          { kind: 'image', file: 'sample.png', name: 'mock.png' },
        ],
      },
      {
        id: 'img',
        role: 'image',
        text: '',
        image: { status: 'ready', file: 'sample.png', prompt: 'A render cache diagram' },
      },
      { id: 'img2', role: 'image', text: '', image: { status: 'generating' } },
      {
        id: 'img3',
        role: 'image',
        text: '',
        image: { status: 'failed', failure: 'Codex reached its image generation limit.' },
      },
    ],
  } as unknown as (typeof snapshot.sessions)[number]);
  await update('planned');
  const plan = page.getByRole('region', { name: 'Plan' });
  await plan.getByText('Ready for your review').waitFor();
  await plan.locator('.callout.warning').getByText('Old keys must not be reused.').waitFor();
  await plan.getByRole('table').waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Allow once' }).count(),
    0,
    'the card answers it',
  );
  // Code is really highlighted, with colors from our own tokens.
  const tokens = await plan
    .locator('.code-block code span span')
    .evaluateAll((spans) => new Set(spans.map((span) => (span as HTMLElement).style.color)).size);
  assert.ok(tokens > 2, `highlighted code has several colors (${tokens})`);
  await plan
    .getByRole('navigation', { name: 'Plan outline' })
    .getByRole('button', { name: 'Tests' })
    .click();
  await plan.getByRole('button', { name: 'Copy plan' }).click();
  assert.equal((await sentOf('copy')).at(-1).text, planText);
  await plan.getByRole('button', { name: 'Save plan to docs/agent-work' }).click();
  await plan.getByRole('button', { name: 'Keep planning' }).click();
  assert.equal((await sentOf('keepPlanning')).length, 1);
  await plan.getByRole('button', { name: 'Build it' }).click();
  assert.equal((await sentOf('buildPlan')).at(-1).id, 'planned');
  await page.screenshot({ path: 'docs/screenshots/plan.png' });

  // Images: a generated one opens full size; generating and failed states say so.
  await page.getByRole('button', { name: 'View image full size' }).click();
  await page.getByRole('dialog', { name: 'Image viewer' }).waitFor();
  assert.ok(
    await page
      .locator('.lightbox img')
      .evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
    'the image loads under the policy',
  );
  await page.keyboard.press('Escape');
  await page.getByText('Generating image…').waitFor();
  await page.getByText('Codex reached its image generation limit.').waitFor();
  await page.getByRole('button', { name: 'Reveal' }).click();
  assert.deepEqual((await sentOf('openImage')).at(-1), {
    type: 'openImage',
    file: 'sample.png',
    reveal: true,
  });
  await page.screenshot({ path: 'docs/screenshots/images.png' });

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
  assert.equal(
    await menu.getByRole('option', { name: /@claude/ }).count(),
    0,
    'agents only lead a message',
  );
  await page.screenshot({ path: 'docs/screenshots/context-menu.png' });
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
  await box.press('ArrowDown');
  await box.press('ArrowDown');
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

  // Pasting an image sends it to the host, which replies with a stored file.
  await box.focus();
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('textarea')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  await page.waitForFunction(() =>
    (window as any).sent.some((message: any) => message.type === 'attachImage'),
  );
  assert.equal((await sentOf('attachImage')).at(-1).name, 'shot.png');
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: { kind: 'image', file: 'sample.png', name: 'shot.png' },
      },
      '*',
    ),
  );
  await page.locator('.composer .attachment-chip img').waitFor();
  await page.getByRole('button', { name: 'Remove shot.png' }).click();

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
    await page.screenshot({ path: `docs/screenshots/sidebar-${width}.png` });
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
  await page.screenshot({ path: 'docs/screenshots/sidebar-model.png' });
  await page.keyboard.press('Escape');
  await update(undefined);
  // A new thread puts the composer first, with recent threads under it.
  await page.getByRole('navigation', { name: 'Recent threads' }).waitFor();
  await page
    .getByRole('button', { name: /Try Plan Mode|Mode: Agent/ })
    .first()
    .waitFor();
  await page.screenshot({ path: 'docs/screenshots/sidebar-new-thread.png' });
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.screenshot({ path: 'docs/screenshots/sidebar-new-model.png' });
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
    await page.screenshot({ path: `docs/screenshots/conversation-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => document.body.classList.add('vscode-light'));
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('tablist', { name: 'Agents' }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/light-theme.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.body.classList.remove('vscode-light'));
  await update(undefined);
  await page.screenshot({ path: 'docs/screenshots/overview.png' });
  assert.deepEqual(errors, []);
  console.log(
    'UI checks passed: no-prompt start, model and effort menus, modes, plan card, Markdown and highlighting, images, the @ and # menu, attachments, worktree opt-in, thinking, diffs, questions, usage, child threads, approvals, drafts, changes panel, side bar widths, and 4 viewport sizes.',
  );
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure.png' });
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
  preview.kill();
}
