import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Session } from '../src/core/model';

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
// The hostile visual below is meant to be blocked; everything else must load cleanly.
let expectBlocked = false;
page.on('console', (message) => {
  if (/Content Security Policy/i.test(message.text()) && !expectBlocked)
    errors.push(message.text());
});
await mkdir('test-results/screenshots', { recursive: true });
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
            id: 'shell-diff',
            role: 'tool',
            text: '',
            tool: {
              kind: 'other',
              name: 'filesystemChanges',
              title: 'Observed file changes',
              status: 'completed',
              diffSource: 'filesystem',
              diffs: [
                {
                  path: 'src/shell-edit.ts',
                  kind: 'update',
                  patch: '@@ edit @@\n-before\n+after',
                  additions: 1,
                  deletions: 1,
                },
              ],
              captureNote: '1 path skipped (capture limits, symlinks, or unreadable files).',
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
              input: 'Double-check the plan compiler cache key.',
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
              input: 'Write the release notes',
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
  const box = page.locator('textarea[aria-label="Message your agent"]');

  // The panel fills the webview despite VS Code's injected body padding, with a left divider.
  const frame = await page.evaluate(() => ({
    padding: getComputedStyle(document.body).paddingLeft,
    left: document.querySelector('.workspace')?.getBoundingClientRect().left,
    border: getComputedStyle(document.querySelector('.workspace') as Element).borderLeftWidth,
    font: getComputedStyle(document.body).fontFamily.split(',')[0].trim() === 'system-ui',
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
  await page.screenshot({ path: 'test-results/screenshots/model-selector.png' });
  // Choosing a provider on the left shows its models on the right, by mouse or arrow key.
  await rail.getByRole('tab', { name: 'Claude', exact: true }).click();
  await page.getByRole('option', { name: 'Sonnet 5.5' }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'GPT-6.1-Sol' }).count(), 0);
  // Older versions wait behind More models.
  assert.equal(await page.getByRole('option', { name: 'Opus 4.8' }).count(), 0);
  await page.getByRole('option', { name: /More models/ }).click();
  // The highlight moves to the first revealed row, with its description inline.
  await page.getByRole('option', { name: 'Opus 4.8', selected: true }).waitFor();
  await page
    .getByRole('option', { name: 'Opus 4.8' })
    .getByText('Best for everyday, complex tasks')
    .waitFor();
  await page.screenshot({ path: 'test-results/screenshots/model-selector-claude.png' });
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
  await page.screenshot({ path: 'test-results/screenshots/model-selector-search.png' });
  assert.equal(await page.getByRole('option').count(), 1, 'search filters across agents');
  await search.press('Enter');
  await page.getByRole('button', { name: /^Model: Claude Sonnet/ }).waitFor();
  // Effort has its own menu, for the levels the chosen model supports.
  await page.getByRole('button', { name: 'Model: Claude Sonnet 5.5' }).waitFor();
  await page.getByRole('button', { name: /^Effort:/ }).click();
  assert.equal(await page.getByRole('menuitemradio').count(), 4, 'default plus three levels');
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await page.getByRole('button', { name: 'Effort: High' }).waitFor();
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
  // A mention with no prompt yet waits, instead of sending its own text to the current agent.
  await box.fill('@claude ');
  assert.equal(await page.getByRole('button', { name: 'Send message' }).isDisabled(), true);
  await box.press('Enter');
  assert.equal((await sentOf('start')).length, 1, 'a bare mention does not start a thread');
  await box.fill('@codex Try it in isolation');
  await box.press('Enter');
  const [, mentioned] = await sentOf('start');
  // A first-message mention runs in a card, and your main agent stays your main agent.
  assert.deepEqual(
    [mentioned.delegate, mentioned.text, mentioned.worktree],
    ['codex', 'Try it in isolation', true],
  );
  assert.equal(mentioned.agent, 'claude');
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

  const pickAgent = async (agent: string, option: string) => {
    await page.getByRole('button', { name: /^Model:/ }).click();
    await page.getByRole('tablist').getByRole('tab', { name: agent, exact: true }).click();
    await page.getByRole('option', { name: option }).click();
  };
  await pickAgent('Codex', 'GPT-6-Luna');
  catalog.codex.models[1].efforts.unshift('none');
  await update(undefined);
  // Thinking is one click, and stays within what the model supports.
  const thinkingToggle = page.getByRole('button', { name: 'Thinking', exact: true });
  const pressed = async (value: 'true' | 'false') =>
    page.waitForFunction(
      (want) =>
        document.querySelector('button[aria-label="Thinking"]')?.getAttribute('aria-pressed') ===
        want,
      value,
    );
  await pressed('false');
  await thinkingToggle.click();
  await pressed('true');
  await thinkingToggle.click();
  await pressed('false');
  // This model can't turn thinking off, so the toggle goes On, then back to Default.
  catalog.codex.models[1].efforts.shift();
  await update(undefined);
  await thinkingToggle.click();
  await pressed('true');
  await thinkingToggle.click();
  await pressed('false');
  assert.equal(await thinkingToggle.isEnabled(), true);
  catalog.codex.models[1].efforts.unshift('none');
  await update(undefined);

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
    mode: 'auto',
    runtime: { mcpServers: [{ name: 'figma', status: 'failed' }] },
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
  await page.screenshot({ path: 'test-results/screenshots/questions.png' });
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
  await questionCard.waitFor({ state: 'detached' });
  await update('asking');
  await questionCard.getByText('1 of 3').waitFor();
  await questionCard.focus();
  await page.keyboard.press('Escape');
  const skipped = (await sentOf('approve')).filter((item: any) => item.requestId === 'q-1').at(-1);
  assert.deepEqual([skipped.allowed, skipped.answers], [false, {}]);
  // Usage: a quiet ring with the CLI's own numbers, and a way forward when nearly full.
  const ring = page.getByRole('button', { name: 'Context 88% used' });
  assert.match(await ring.innerText(), /Ctx 88%/);
  assert.match(await ring.innerText(), /Week/);
  await ring.hover();
  const usageCard = page.getByRole('dialog', { name: 'Thread details' });
  await usageCard.getByText('176K of 200K tokens').waitFor();
  await usageCard.getByText('Weekly limit').waitFor();
  assert.equal(await usageCard.getByText('Expired').count(), 0, 'an elapsed window is not shown');
  await usageCard.getByRole('button', { name: 'Hand off to another agent' }).waitFor();
  // The card is also the inspector: what the CLI reported, and a failed MCP server gets a dot.
  await usageCard.getByText('Mode').waitFor();
  await usageCard.getByText('figma: failed').waitFor();
  await page.getByTestId('mcp-dot').waitFor();
  // At most one nudge, the most useful one, and closing it stays closed.
  const nudges = page.locator('.composer-caption output');
  assert.equal(await nudges.count(), 1);
  await nudges.getByText('Close to a limit.').waitFor();
  await page.screenshot({ path: 'test-results/screenshots/usage.png' });
  await page.getByRole('button', { name: 'Dismiss: Close to a limit.' }).click();
  assert.equal(await nudges.count(), 0);
  await page.mouse.move(0, 0);
  await usageCard.waitFor({ state: 'detached' });
  await update('codex-one');

  // Child threads: inline, and nested in the sidebar with a working rail.
  const nav = page.getByRole('navigation', { name: 'Agent sessions' });
  await nav.getByRole('button', { name: 'Double-check the compiler' }).waitFor();
  await page.getByText('planCache').waitFor();
  await page.getByText('Release notes are ready for review.').waitFor();
  await page.getByRole('button', { name: 'Add this result to your next message' }).waitFor();

  // Picking an agent mid-message moves it to the front, keeping your words.
  await box.fill('');
  await box.pressSequentially('use @claude');
  await page.getByRole('option', { name: /@claude2/ }).waitFor();
  assert.match((await page.getByRole('option').first().textContent()) ?? '', /@claude/);
  await box.press('Enter');
  assert.equal(await box.inputValue(), '@claude use ');
  await box.fill('');

  // An agent can be run from the composer without leaving the thread.
  await box.fill('@cl');
  await page.getByRole('option', { name: /@claude2/ }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/mention.png' });
  await box.press('ArrowDown');
  await box.press('Enter');
  assert.equal(await box.inputValue(), '@claude2 ');
  // A mention doesn't replace your main agent's chip. Another one says who it goes to.
  const mainModel = await page.getByRole('button', { name: /^Model:/ }).getAttribute('aria-label');
  assert.doesNotMatch(mainModel ?? '', /Claude 2/);
  await page.locator('.composer').getByText('Claude 2', { exact: true }).waitFor();
  await box.fill('@codex Write the migration');
  assert.equal(
    await page.getByRole('button', { name: /^Model:/ }).getAttribute('aria-label'),
    mainModel,
  );
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

  // A card says who asked, and in what words.
  const sentPrompts = page.locator('.sent-prompt');
  await sentPrompts
    .filter({ hasText: /You asked Codex|You asked Claude/ })
    .first()
    .waitFor();
  await sentPrompts.getByText('Write the release notes').first().waitFor();
  await sentPrompts
    .filter({ hasText: /Codex asked/ })
    .getByText(/cache key/)
    .first()
    .waitFor();

  // A thread in its terminal says so, and the composer steps aside without losing your draft.
  await box.fill('Keep this draft');
  const terminalThread = snapshot.sessions.find((item) => item.id === 'codex-one') as any;
  const terminalBefore = {
    nativeId: terminalThread.nativeId,
    approval: terminalThread.approval,
    status: terminalThread.status,
  };
  await page.getByRole('button', { name: 'Open in terminal' }).waitFor();
  terminalThread.nativeId = 'native-root';
  terminalThread.inTerminal = true;
  terminalThread.approval = undefined;
  terminalThread.status = 'idle';
  await update('codex-one');
  await page.getByRole('button', { name: 'Back to chat' }).click();
  assert.equal((await sentOf('terminalBack')).at(-1).id, 'codex-one');
  await page.getByRole('button', { name: 'Show terminal' }).click();
  assert.equal((await sentOf('terminal')).at(-1).id, 'codex-one');
  await page.getByRole('img', { name: 'In terminal' }).first().waitFor();
  await page.screenshot({ path: 'test-results/screenshots/terminal-strip.png' });
  terminalThread.inTerminal = false;
  Object.assign(terminalThread, terminalBefore);
  await update('codex-one');
  assert.equal(await box.inputValue(), 'Keep this draft');
  await box.fill('');

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
  await page.screenshot({ path: 'test-results/screenshots/changes-panel.png' });
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

  // Skills: / opens a searchable menu, a pick becomes a chip, and a chip is only a request.

  (snapshot as any).skills = {
    codex: {
      status: 'ready',
      skills: [
        {
          name: 'review',
          description: 'Reviews the current diff for bugs',
          source: 'project',
          path: '/skills/review/SKILL.md',
          enabled: true,
        },
        {
          name: 'release',
          description: 'Cuts a release',
          source: 'personal',
          path: '/skills/release/SKILL.md',
          enabled: true,
        },
        {
          name: 'off',
          description: 'Turned off',
          source: 'system',
          path: '/skills/off/SKILL.md',
          enabled: false,
        },
      ],
      problems: ['bad/SKILL.md is missing a description'],
    },
    claude: {
      status: 'ready',
      skills: [{ name: 'deploy', description: 'Deploys the app', enabled: true }],
      problems: [],
    },
    claud2: { status: 'ready', skills: [], problems: [] },
  };
  await update(undefined);
  await pickAgent('Codex', 'GPT-6.1-Sol');
  await box.fill('/');
  const skillMenu = page.getByRole('listbox', { name: 'Skills' });
  await skillMenu.waitFor();
  assert.ok((await sentOf('refreshSkills')).length > 0, 'opening the menu refreshes behind it');
  assert.equal(await skillMenu.getByText('off', { exact: true }).count(), 0, 'off stays out');
  await skillMenu.getByText('1 skill couldn’t be read.').waitFor();
  await box.pressSequentially('rev');
  await skillMenu.getByText('review', { exact: true }).waitFor();
  assert.equal(await skillMenu.getByText('release', { exact: true }).count(), 0);
  await page.screenshot({ path: 'test-results/screenshots/skills-menu.png' });
  await box.press('Enter');
  assert.equal(await box.inputValue(), '', 'the search text goes when the skill is picked');
  const chip = page.locator('.composer .attachment-chip', { hasText: 'review' });
  await chip.waitFor();
  assert.equal(await page.getByText('Used skill').count(), 0, 'a selection is not use');
  // Another agent without this skill mutes the chip and says so, rather than sending it.
  await pickAgent('Claude', 'Sonnet 5.5');
  await page.getByText('Claude doesn’t have review.').waitFor();
  await box.fill('Check this');
  await box.press('Enter');
  const startsBefore = (await sentOf('start')).length;
  await box.press('Enter');
  assert.equal((await sentOf('start')).length, startsBefore, 'a missing skill blocks the send');
  await pickAgent('Codex', 'GPT-6.1-Sol');
  await box.focus();
  await box.press('Enter');
  const skillStart = (await sentOf('start')).at(-1);
  assert.deepEqual(skillStart.attachments, [
    { kind: 'skill', name: 'review', path: '/skills/review/SKILL.md' },
  ]);
  await page.evaluate(
    (id) => window.postMessage({ type: 'sent', id, text: 'Check this' }, '*'),
    skillStart.draftKey,
  );
  // The panel lists each CLI's skills, and only offers what that CLI can do.
  await box.fill('/');
  await skillMenu.getByText('Manage skills…').dispatchEvent('pointerdown');
  const panel = page.getByRole('dialog', { name: 'Skills' });
  await panel.waitFor();
  await panel.getByRole('button', { name: 'Turn off review' }).click();
  assert.deepEqual((await sentOf('setSkillEnabled')).at(-1), {
    type: 'setSkillEnabled',
    agent: 'codex',
    name: 'review',
    path: '/skills/review/SKILL.md',
    enabled: false,
  });
  await panel.getByRole('button', { name: 'Open' }).first().click();
  assert.equal((await sentOf('openSkill')).at(-1).name, 'review');
  await panel.getByPlaceholder('Search skills…').fill('cut');
  await panel.getByText('release', { exact: true }).waitFor();
  assert.equal(await panel.getByText('review', { exact: true }).count(), 0);
  await panel.getByRole('tab', { name: /^Claude$/ }).click();
  await panel.getByPlaceholder('Search skills…').fill('');
  await panel.getByText('deploy', { exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('button', { name: /Turn off/ }).count(),
    0,
    'Claude has no toggle',
  );
  await page.screenshot({ path: 'test-results/screenshots/skills-panel.png' });
  await page.keyboard.press('Escape');

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
    plan: {
      text: planText,
      status: 'ready',
      updatedAt: Date.now(),
      file: '/plans/render_cache.plan.md',
    },
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
  const plan = page.getByRole('region', { name: 'Created plan' });
  await plan.getByRole('heading', { name: 'Render cache' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Allow once' }).count(),
    0,
    'the card answers it',
  );
  await plan.getByRole('button', { name: 'View Plan' }).click();
  assert.equal((await sentOf('viewPlan')).at(-1).id, 'planned');
  await plan.getByRole('combobox', { name: 'Implementation destination' }).selectOption('worker');
  await plan.getByRole('button', { name: 'Implement plan' }).click();
  assert.equal((await sentOf('buildPlan')).at(-1).agent, 'claude');
  await plan.getByRole('combobox', { name: 'Implementation destination' }).selectOption('current');
  await plan.getByRole('button', { name: 'Implement plan' }).click();
  assert.deepEqual((await sentOf('buildPlan')).at(-1), { type: 'buildPlan', id: 'planned' });
  assert.equal(await plan.getByRole('button', { name: 'Implement in Auto' }).count(), 0);
  // Cmd+Enter builds with an empty composer. A message you're writing stays yours to send.
  const buildsBefore = (await sentOf('buildPlan')).length;
  await page.keyboard.press('Control+Enter');
  assert.equal((await sentOf('buildPlan')).length, buildsBefore + 1);
  // Typing while a plan waits is feedback on it, not a separate turn.
  await box.fill('Use a smaller cache');
  await page.keyboard.press('Control+Enter');
  assert.equal((await sentOf('buildPlan')).length, buildsBefore + 1);
  assert.deepEqual((await sentOf('keepPlanning')).at(-1), {
    type: 'keepPlanning',
    id: 'planned',
    feedback: 'Use a smaller cache',
  });
  assert.equal(await box.inputValue(), '');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/screenshots/plan.png' });

  const diagramSession = snapshot.sessions.find((item) => item.id === 'planned');
  assert.ok(diagramSession);
  diagramSession.status = 'completed';
  diagramSession.approval = undefined;
  (diagramSession as unknown as Session).messages.push({
    id: 'diagram-test',
    role: 'assistant',
    text: '```mermaid\nflowchart LR\n A[Plan] --> B[Worker]\n```',
    at: Date.now(),
  } as any);
  await update('planned');
  await page.getByRole('region', { name: 'Mermaid diagram' }).locator('svg').waitFor();
  const diagram = page.getByRole('region', { name: 'Mermaid diagram' }).locator('svg');
  const initialDiagram = await diagram.getAttribute('id');
  await page.evaluate(() => {
    document.body.style.setProperty('--vscode-editor-background', '#fbfaf7');
    document.body.style.setProperty('--vscode-foreground', '#202020');
    document.body.style.setProperty('--vscode-input-background', '#eeeeee');
    document.body.style.setProperty('--vscode-panel-border', '#555555');
  });
  await page.waitForFunction((id) => {
    const svg = document.querySelector('[aria-label="Mermaid diagram"] svg');
    return svg && svg.id !== id;
  }, initialDiagram);
  assert.match(await diagram.innerHTML(), /#202020/);
  await page.evaluate(() => {
    for (const key of ['editor-background', 'foreground', 'input-background', 'panel-border'])
      document.body.style.removeProperty(`--vscode-${key}`);
  });

  // Images: a generated one opens full size; generating and failed states say so.
  await page.getByRole('button', { name: 'View image full size: mock.png' }).click();
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'View image full size: A render cache diagram' }).click();
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor();
  assert.ok(
    await page
      .locator('.lightbox img')
      .evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
    'the image loads under the policy',
  );
  await page.getByRole('button', { name: 'Actual size', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Actual size', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  const viewerBounds = await page.getByRole('dialog', { name: /Image viewer:/ }).boundingBox();
  assert.ok(
    viewerBounds &&
      viewerBounds.x >= 0 &&
      viewerBounds.y >= 0 &&
      viewerBounds.x + viewerBounds.width <= 320 &&
      viewerBounds.y + viewerBounds.height <= 640,
    `image viewer fits narrow panels: ${JSON.stringify(viewerBounds)}`,
  );
  await page.screenshot({ path: 'test-results/screenshots/image-viewer-narrow.png' });
  if (viewport) await page.setViewportSize(viewport);
  await page.screenshot({ path: 'test-results/screenshots/image-viewer.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View image full size: A render cache diagram' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Fit', exact: true }).getAttribute('aria-pressed'),
    'true',
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
  await page.screenshot({ path: 'test-results/screenshots/images.png' });

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

  // Pasting an image sends it to the host, which replies with a stored file.
  await box.fill('Keep my words');
  await box.focus();
  await box.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5));
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
  const thumbnail = page.locator('.composer .attachment-image');
  await thumbnail.locator('img').waitFor();
  assert.equal(await box.inputValue(), 'Keep my words');
  assert.equal(await box.evaluate((element: HTMLTextAreaElement) => element.selectionStart), 5);
  assert.equal(await thumbnail.innerText(), '');
  const previewButton = thumbnail.getByRole('button', { name: /View image full size/ });
  assert.equal(
    await previewButton.evaluate((element) => getComputedStyle(element).cursor),
    'zoom-in',
  );
  const dimensions = await previewButton.boundingBox();
  assert.ok(dimensions && dimensions.width >= 90 && dimensions.height >= 70);
  await previewButton.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (element) => document.activeElement === element,
    await previewButton.elementHandle(),
  );
  await previewButton.click();
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: { kind: 'image', file: 'sample-2.png', name: 'second.png' },
      },
      '*',
    ),
  );
  await page.locator('.composer .attachment-image').nth(1).locator('img').waitFor();
  assert.equal(await box.inputValue(), 'Keep my words');
  await box.press('Enter');
  await page.waitForFunction(() =>
    (window as any).sent.some(
      (message: any) =>
        message.type === 'send' &&
        message.text === 'Keep my words' &&
        message.attachments?.length === 2,
    ),
  );
  assert.deepEqual(
    (await sentOf('send')).at(-1).attachments.map((item: any) => item.name),
    ['shot.png', 'second.png'],
  );
  await page.getByRole('button', { name: /Remove .*shot.png/ }).click();
  await page.getByRole('button', { name: /Remove second.png/ }).click();
  await page.evaluate(() =>
    window.postMessage({ type: 'sent', id: 'claude-two', text: 'Keep my words' }, '*'),
  );
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: { kind: 'image', file: 'missing.png', name: 'missing.png' },
      },
      '*',
    ),
  );
  await page.getByText('Image unavailable', { exact: true }).waitFor();
  assert.ok(
    await page.getByRole('button', { name: 'View image full size: missing.png' }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Remove missing.png', exact: true }).click();

  // Mascot state follows current activity; reduced motion freezes the same first frame.
  const mascotSession = snapshot.sessions.find((item) => item.id === 'claude-two') as Session;
  const beforeMascot = { ...mascotSession };
  Object.assign(mascotSession, {
    status: 'running',
    mode: 'auto',
    messages: [],
    approval: undefined,
    plan: undefined,
    transition: undefined,
  });
  for (const activity of ['working', 'thinking', 'planning', 'coding', 'reading'] as const) {
    mascotSession.mode = activity === 'planning' ? 'plan' : 'auto';
    mascotSession.messages =
      activity === 'thinking'
        ? [{ id: 'mascot-thought', role: 'thinking', text: 'Reviewing the task' }]
        : activity === 'coding' || activity === 'reading'
          ? [
              {
                id: 'mascot-tool',
                role: 'tool',
                text: '',
                tool: {
                  kind: activity === 'coding' ? 'edit' : 'read',
                  name: activity,
                  title: 'src/app.ts',
                  status: 'running',
                },
              },
            ]
          : [];
    await update(mascotSession.id);
    const mascot = page.locator(`.main .mascot[data-activity="${activity}"]`);
    await mascot.waitFor();
    assert.equal(
      await mascot.evaluate((element) => getComputedStyle(element, '::before').animationName),
      'none',
    );
    await mascot.evaluate(async (element) => {
      const background = getComputedStyle(element, '::before').backgroundImage;
      const image = new Image();
      image.src = background.slice(5, -2);
      await image.decode();
      if (image.naturalWidth !== 1024 || image.naturalHeight !== 128)
        throw new Error(`Unexpected mascot strip: ${image.naturalWidth}×${image.naturalHeight}`);
    });
    const gif = await page.evaluate(async (state) => {
      const response = await fetch(`/mascot/${state}.gif`);
      const decoder = new (window as any).ImageDecoder({
        data: await response.arrayBuffer(),
        type: 'image/gif',
      });
      await decoder.tracks.ready;
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Cannot inspect GIF frames');
      const pixels: Uint8ClampedArray[] = [];
      for (const frameIndex of [0, 4]) {
        const { image } = await decoder.decode({ frameIndex });
        context.clearRect(0, 0, 128, 128);
        context.drawImage(image, 0, 0);
        pixels.push(context.getImageData(0, 0, 128, 128).data);
        image.close();
      }
      const frameCount = decoder.tracks.selectedTrack.frameCount;
      decoder.close();
      return { frameCount, changed: pixels[0].some((value, index) => value !== pixels[1][index]) };
    }, activity);
    assert.equal(gif.frameCount, 8, `${activity} GIF contains eight animation frames`);
    assert.ok(gif.changed, `${activity} GIF has visibly different frames`);
    await page.screenshot({ path: `test-results/screenshots/mascot-${activity}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(
    await page
      .locator('.main .mascot')
      .evaluate((element) => getComputedStyle(element, '::before').animationName),
    'mascot-frames',
  );
  mascotSession.status = 'waiting';
  await update(mascotSession.id);
  const attentive = page.locator('.main .mascot[data-activity="attentive"]');
  await attentive.waitFor();
  assert.equal(
    await attentive.evaluate((element) => getComputedStyle(element, '::before').animationName),
    'none',
  );
  for (const status of ['completed', 'failed', 'interrupted'] as const) {
    mascotSession.status = status;
    await update(mascotSession.id);
    await page.locator('.main .mascot').waitFor({ state: 'detached' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  Object.assign(mascotSession, beforeMascot);

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
  for (const [className, background, foreground] of [
    ['vscode-dark', '#181818', '#dedede'],
    ['vscode-dark', '#102030', '#d0e0f0'],
    ['vscode-high-contrast', '#000000', '#ffffff'],
    ['vscode-high-contrast-light', '#ffffff', '#000000'],
  ]) {
    const colors = await page.evaluate(
      ({ className, background, foreground }) => {
        document.documentElement.dataset.appearance = 'editor';
        document.body.className = className;
        document.body.style.setProperty('--vscode-editor-background', background);
        document.body.style.setProperty('--vscode-foreground', foreground);
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, foreground: style.color };
      },
      { className, background, foreground },
    );
    assert.notEqual(colors.background, colors.foreground);
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue('--canvas').trim(),
      ),
      background,
    );
  }
  await page.evaluate(() => {
    document.body.className = '';
    document.body.style.removeProperty('--vscode-editor-background');
    document.body.style.removeProperty('--vscode-foreground');
  });
  const canvasWith = (appearance: string, className: string) =>
    page.evaluate(
      ({ appearance, className }) => {
        document.documentElement.dataset.appearance = appearance;
        document.body.className = className;
        document.body.style.setProperty('--vscode-editor-background', '#444444');
        return getComputedStyle(document.body).getPropertyValue('--canvas').trim();
      },
      { appearance, className },
    );
  assert.equal(await canvasWith('cursor', 'vscode-dark'), '#181818', 'any dark theme');
  assert.equal(await canvasWith('editor', 'vscode-dark'), '#444444', 'turned off');
  assert.equal(await canvasWith('cursor', 'vscode-light'), '#444444', 'light keeps the editor');
  assert.equal(await canvasWith('cursor', 'vscode-high-contrast'), '#444444');
  assert.equal(await canvasWith('cursor', 'vscode-high-contrast-light'), '#444444');
  await page.evaluate(() => document.body.style.removeProperty('--vscode-editor-background'));
  await canvasWith('cursor', 'vscode-dark');
  await page.evaluate(() => document.body.style.removeProperty('--vscode-editor-background'));

  // Every mode has its own colour on the chip and send button, and stays readable.
  const luminance = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
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

  // A Plan reply in plain prose, with no plan card, can still be built.
  moded.mode = 'plan';
  moded.status = 'completed';
  await update('claude-two');
  const sendsBefore = (await sentOf('send')).length;
  await box.fill('One more thing');
  await page.getByRole('button', { name: 'Implement', exact: true }).click();
  assert.equal((await sentOf('setMode')).at(-1).mode, 'auto');
  assert.equal((await sentOf('send')).length, sendsBefore, 'a draft stays yours to send');
  assert.equal(await box.inputValue(), 'One more thing');
  await box.fill('');
  await page.getByRole('button', { name: 'Implement', exact: true }).click();
  assert.equal((await sentOf('send')).at(-1).text, 'Implement what you proposed above.');
  moded.mode = undefined;
  moded.status = 'idle';

  // Finished subagents wait behind a toggle. Running ones never do.
  await update('planned');
  const threads = page.getByRole('navigation', { name: 'Agent sessions' });
  const earlierToggle = threads.getByRole('button', { name: /\d+ earlier/ });
  await earlierToggle.waitFor();
  assert.equal(await threads.getByRole('button', { name: /Write release notes/ }).count(), 0);
  assert.ok(await threads.getByRole('button', { name: /Double-check the compiler/ }).count());
  await earlierToggle.click();
  await threads.getByRole('button', { name: /Write release notes/ }).waitFor();
  await threads.getByRole('button', { name: 'Hide earlier' }).click();
  await threads.getByPlaceholder('Find a thread…').fill('release notes');
  await threads.getByRole('button', { name: /Write release notes/ }).waitFor();
  await threads.getByPlaceholder('Find a thread…').fill('');
  await threads.getByRole('button', { name: 'Running only' }).click();
  assert.equal(await threads.getByRole('button', { name: /Playback review/ }).count(), 0);
  assert.ok(await threads.getByRole('button', { name: /Double-check the compiler/ }).count());
  await page.screenshot({ path: 'test-results/screenshots/running-only.png' });
  await threads.getByRole('button', { name: 'Running only' }).click();
  await threads.getByRole('button', { name: /Playback review/ }).waitFor();

  // Open threads are tabs. A new one doesn't disturb the others, and closing one stops nothing.
  const tablist = page.getByRole('tablist', { name: 'Open threads' });
  const tabNamed = (name: RegExp | string) => tablist.getByRole('tab', { name });
  await update('claude-two');
  await update('planned');
  await tabNamed(/Playback review/).waitFor();
  await tabNamed(/Plan the cache/).waitFor();
  // Every click is a new chat, and what you typed stays in its own tab, sent or not.
  const draftTabs = () => tablist.getByRole('tab', { name: /New chat|unsent words/ }).count();
  const draftsBefore = await draftTabs();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await box.fill('unsent words');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  assert.equal(await draftTabs(), draftsBefore + 3);
  assert.equal(await box.inputValue(), '', 'a new chat starts empty');
  await tabNamed(/Plan the cache/).waitFor();
  await tabNamed(/unsent words/).click();
  assert.equal(await box.inputValue(), 'unsent words');
  await page.screenshot({ path: 'test-results/screenshots/draft-tabs.png' });
  await update('planned');
  await tabNamed(/unsent words/).waitFor();
  await page.getByRole('button', { name: 'Close unsent words' }).click({ force: true });
  await page.waitForFunction(
    () => !document.querySelector('[role="tablist"]')?.textContent?.includes('unsent words'),
  );
  // Which threads need you shows on their tabs, and only until you've looked.
  const backgrounded = snapshot.sessions.find(
    (item) => item.id === 'claude-two',
  ) as unknown as Session;
  backgrounded.status = 'waiting';
  await update('planned');
  await tablist.getByRole('img', { name: 'Needs your review' }).first().waitFor();
  backgrounded.status = 'completed';
  backgrounded.updatedAt = Date.now() + 60_000;
  await update('planned');
  await tablist.getByRole('img', { name: 'Finished since you last looked' }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/thread-tabs.png' });
  await tabNamed(/Playback review/).click();
  assert.equal((await sentOf('select')).at(-1).id, 'claude-two');
  await update('claude-two');
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Finished since you last looked"]'),
  );
  backgrounded.status = 'idle';
  await update('planned');
  const interruptsBefore = (await sentOf('interrupt')).length;
  await page.getByRole('button', { name: 'Close Playback review' }).click({ force: true });
  await page.waitForFunction(
    () => !document.querySelector('[role="tablist"]')?.textContent?.includes('Playback review'),
  );
  assert.equal((await sentOf('interrupt')).length, interruptsBefore, 'closing a tab stops nothing');
  await threads.getByRole('button', { name: /Playback review/ }).waitFor();
  // Closing the open tab moves to its neighbour, and a snapshot already on its way can't undo it.
  await update('claude-two');
  await page.getByRole('button', { name: 'Close Playback review' }).click();
  await page.evaluate(
    (snapshot) => window.postMessage({ type: 'snapshot', snapshot, selectedId: 'claude-two' }, '*'),
    snapshot,
  );
  await page.waitForTimeout(100);
  assert.equal(await tabNamed(/Playback review/).count(), 0, 'a stale snapshot stays closed');
  await update('planned');
  await tablist.getByRole('tab', { name: /Plan the cache/ }).waitFor();

  // A visual renders in a sandbox: it can draw and animate, and nothing else.
  expectBlocked = true;
  // Chromium reports a blocked request too, so what counts is whether it was let out.
  const reachedNetwork: string[] = [];
  const blockedReasons: string[] = [];
  await page.route('**://example.test/**', (route) => {
    reachedNetwork.push(route.request().url());
    return route.abort();
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('example.test'))
      blockedReasons.push(`${request.url()} ${request.failure()?.errorText}`);
  });
  const visualHost = snapshot.sessions.find(
    (item) => item.id === 'claude-two',
  ) as unknown as Session;
  visualHost.mode = 'ask';
  visualHost.status = 'running';
  const visualMessage = {
    id: 'visual-test',
    role: 'assistant',
    text: `\`\`\`visual
<div id="hello" class="card fade-in" style="height:320px">Flow <a id="docs" href="https://example.test/docs">docs</a>
<svg viewBox="0 0 40 10" width="200"><line class="dash-flow" x1="0" y1="5" x2="40" y2="5" stroke="currentColor"/></svg></div>
<img id="remote" src="https://example.test/remote.png">
<img src="missing.png" onerror="parent.document.body.dataset.pwned='handler'">
<script>parent.document.body.dataset.pwned='script'</script>
\`\`\``,
    at: Date.now(),
  };
  (visualHost.messages as unknown[]).push({ ...visualMessage, text: '```visual\n<div>half' });
  await update('claude-two');
  await page.getByText('Drawing a visual…').waitFor();
  assert.equal(await page.locator('iframe[title="Visual explanation"]').count(), 0);
  (visualHost.messages as unknown[]).pop();
  (visualHost.messages as unknown[]).push(visualMessage);
  visualHost.status = 'completed';
  await update('claude-two');
  const visual = page.frameLocator('iframe[title="Visual explanation"]');
  await visual.locator('#hello').waitFor();
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="Visual explanation"]') as HTMLElement;
    return frame && frame.getBoundingClientRect().height >= 320;
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.body.dataset.pwned), undefined);
  assert.deepEqual(reachedNetwork, [], 'a visual reaches no network');
  assert.ok(
    blockedReasons.every((reason) => reason.endsWith(' csp')),
    String(blockedReasons),
  );
  assert.equal(
    await visual.locator('#remote').evaluate((image) => (image as HTMLImageElement).naturalWidth),
    0,
  );
  assert.equal(
    await page.locator('iframe[title="Visual explanation"]').getAttribute('sandbox'),
    'allow-same-origin',
  );
  await visual.locator('#docs').click();
  assert.equal((await sentOf('link')).at(-1).href, 'https://example.test/docs');
  await page.screenshot({ path: 'test-results/screenshots/visual.png' });
  (visualHost.messages as unknown[]).pop();
  visualHost.mode = undefined;
  visualHost.status = 'idle';
  expectBlocked = false;
  await update('planned');

  // Continuing in another agent moves the draft with a context chip, and sends nothing by itself.
  const continueSource = {
    ...(snapshot.sessions.find((item) => item.id === 'planned') as object),
    id: 'continue-source',
    title: 'Cache the render graph',
    provider: 'codex',
    claudeCommand: undefined,
    parentId: undefined,
    plan: undefined,
    approval: undefined,
    status: 'completed',
    messages: [
      { id: 'cs1', role: 'user', text: 'Cache the render graph' },
      { id: 'cs2', role: 'assistant', text: 'Added a cache keyed by node hash.' },
    ],
  };
  const continueLinked = {
    ...continueSource,
    id: 'continue-linked',
    title: 'Review the cache',
    provider: 'claude',
    claudeCommand: 'claude',
    continuedFrom: 'continue-source',
    messages: [{ id: 'cl1', role: 'assistant', text: 'Reviewed.' }],
  };
  snapshot.sessions.push(continueSource as any, continueLinked as any);
  await update('continue-source');
  await page.getByRole('button', { name: /Continued in Claude: Review the cache/ }).waitFor();
  await box.fill('Carry on from here');
  const quiet = async () =>
    (await sentOf('start')).length +
    (await sentOf('send')).length +
    (await sentOf('delegate')).length;
  const quietBefore = await quiet();
  await page.locator('main > header').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Continue in Claude 2' }).click();
  const contextChip = page.getByRole('button', {
    name: 'Preview Context from Cache the render graph',
  });
  await contextChip.waitFor();
  assert.equal(await box.inputValue(), 'Carry on from here', 'the draft moves with you');
  const continuedModel = await page
    .getByRole('button', { name: /^Model:/ })
    .getAttribute('aria-label');
  assert.match(continuedModel ?? '', /Claude 2/);
  assert.doesNotMatch(continuedModel ?? '', /gpt/i, 'no Codex model carries over to Claude');
  assert.equal(await quiet(), quietBefore, 'switching sends nothing by itself');
  await contextChip.click();
  assert.deepEqual((await sentOf('previewContext')).at(-1), {
    type: 'previewContext',
    id: 'continue-source',
    history: 'recent',
  });
  await page.screenshot({ path: 'test-results/screenshots/continue-chip.png' });
  await box.press('Enter');
  const continuedStart = (await sentOf('start')).at(-1);
  assert.equal(continuedStart.agent, 'claud2');
  assert.equal(continuedStart.continuedFrom, 'continue-source');
  assert.deepEqual(continuedStart.attachments, [
    { kind: 'thread', id: 'continue-source', title: 'Cache the render graph', history: 'recent' },
  ]);
  await page.evaluate(
    (draftKey) =>
      window.postMessage({ type: 'sent', id: draftKey, text: 'Carry on from here' }, '*'),
    continuedStart.draftKey,
  );
  // Going back to an agent with a linked thread resumes that thread instead of starting one.
  await update('continue-source');
  await box.fill('Check it again');
  await page.locator('main > header').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Continue in Claude', exact: true }).click();
  assert.equal((await sentOf('select')).at(-1).id, 'continue-linked');
  await page
    .getByRole('button', { name: /Continued from Codex: Cache the render graph/ })
    .waitFor();
  await contextChip.waitFor();
  assert.equal(await box.inputValue(), 'Check it again');
  await box.press('Enter');
  const resumed = (await sentOf('send')).at(-1);
  assert.equal(resumed.id, 'continue-linked');
  assert.deepEqual(resumed.attachments, [
    { kind: 'thread', id: 'continue-source', title: 'Cache the render graph', history: 'recent' },
  ]);
  await page.evaluate(() =>
    window.postMessage({ type: 'sent', id: 'continue-linked', text: 'Check it again' }, '*'),
  );
  snapshot.sessions.splice(
    snapshot.sessions.findIndex((item) => item.id === 'continue-source'),
    2,
  );
  await update('planned');

  await page.evaluate(() => {
    document.body.className = '';
    document.body.classList.add('vscode-light');
  });
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('tablist', { name: 'Agents' }).waitFor();
  await page.screenshot({ path: 'test-results/screenshots/light-theme.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.body.classList.remove('vscode-light'));
  await update(undefined);
  await page.screenshot({ path: 'test-results/screenshots/overview.png' });
  assert.deepEqual(errors, []);
  console.log(
    'UI checks passed: no-prompt start, model and effort menus, appearance, mode colours, guide toggles, sandboxed visuals, thread filters, thread tabs and signals, modes, plan card, Markdown and highlighting, images, the @ and # menu, attachments, worktree opt-in, thinking, diffs, questions, usage, child threads, approvals, drafts, continuing in another agent, changes panel, side bar widths, and 4 viewport sizes.',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/screenshots/failure.png' });
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
  preview.kill();
}
