import assert from 'node:assert/strict';
import type { Session } from '../src/shared/model';
import { captureGuide, type Guide } from './guide-capture';

function session(id: string, title: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    title,
    provider: 'codex',
    model: 'gpt-6.1-sol',
    mode: 'auto',
    cwd: '/Projects/sample-project',
    workspace: '/Projects/sample-project',
    status: 'completed',
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
    messages: [
      { id: `${id}-u`, role: 'user', text: title },
      { id: `${id}-a`, role: 'assistant', text: 'Ready for your review.' },
    ],
    ...extra,
  };
}

async function show(guide: Guide, selected: Session, others: Session[] = []) {
  guide.ctx.snapshot.sessions = [
    selected,
    ...others,
  ] as unknown as typeof guide.ctx.snapshot.sessions;
  await guide.ctx.update(selected.id);
}

const scenes: Record<string, (guide: Guide) => Promise<void>> = {
  async modes(g) {
    const { page, ctx, caption, click, frame } = g;
    const thread = session('modes', 'Choose how the agent works');
    await show(g, thread);
    await caption('Choose a mode for the task');
    await click(page.getByRole('button', { name: /^Mode:/ }));
    await frame(1800);
    await click(page.getByRole('menuitemradio', { name: /^Ask/ }));
    thread.mode = 'ask';
    await show(g, thread);
    assert.equal((await ctx.sentOf('setMode')).at(-1).mode, 'ask');
    await caption('Ask · Explore code with editing tools disabled');
    await frame(1800);
    await click(page.getByRole('button', { name: /^Mode:/ }));
    await click(page.getByRole('menuitemradio', { name: /^Plan/ }));
    thread.mode = 'plan';
    await show(g, thread);
    await caption('Plan · Research and shape the approach before building');
    await frame(1800);
    await click(page.getByRole('button', { name: /^Mode:/ }));
    await click(page.getByRole('menuitemradio', { name: /^Auto/ }));
    thread.mode = 'auto';
    await show(g, thread);
    await caption('Auto · Work with the installed CLI’s approval settings');
    await frame(2200);
  },
  async models(g) {
    const { ctx, page, caption, click, frame } = g;
    await caption('Choose a model from your installed account’s catalog');
    await click(page.getByRole('button', { name: /^Model:/ }));
    await page.getByRole('combobox').fill('sol');
    await frame(2000);
    await click(page.getByRole('option', { name: 'GPT-6.1-Sol' }));
    await caption('Choose the reasoning effort supported by that model');
    await click(page.getByRole('button', { name: /^Effort:/ }));
    await frame(1800);
    await click(page.getByRole('menuitemradio', { name: 'High', exact: true }));
    await page.getByRole('button', { name: 'Effort: High' }).waitFor();
    await ctx.box.fill('Review the cache implementation and edge cases.');
    await caption('Model and effort are selected · Your prompt remains unsent');
    await frame(2400);
    assert.equal(await ctx.quiet(), 0);
  },
  async 'ask-markdown'(g) {
    const { ctx, caption, frame, click, page } = g;
    const thread = session('ask', 'Explain the request cache', {
      mode: 'ask',
      messages: [
        {
          id: 'ask-u',
          role: 'user',
          text: 'Explain how the request cache works. Include an example.',
        },
        {
          id: 'ask-a',
          role: 'assistant',
          text: '## How the cache works\n\nA **cache hit** reuses a saved response. A **cache miss** fetches the data and stores it.\n\n| Situation | Result |\n| --- | --- |\n| Fresh entry | Reuse cached data |\n| Missing or expired | Fetch and store |\n\n```ts\nconst cached = cache.get(key);\nif (cached && cached.expiresAt > Date.now()) {\n  return cached.value;\n}\nreturn fetchAndCache(key);\n```\n\n> Keep a short expiration time for frequently changing data.',
        },
      ],
    });
    await show(g, thread);
    await caption('Ask · Read structured explanations beside your code');
    await page.getByRole('heading', { name: 'How the cache works' }).waitFor();
    await frame(2500);
    await caption('Tables, highlighted code, and notes make answers easier to scan');
    await page.locator('pre').first().scrollIntoViewIfNeeded();
    await frame(2400);
    await caption('Visual explanations can be turned on or off in Ask mode');
    await click(page.getByRole('button', { name: 'Visual explanations', exact: true }));
    assert.equal((await ctx.sentOf('setGuide')).at(-1).guide, 'richExplanations');
    await frame(1800);
  },
  async 'visual-explanations'(g) {
    const { page, caption, frame } = g;
    await show(
      g,
      session('visual', 'Show the cache flow', {
        mode: 'ask',
        messages: [
          { id: 'vu', role: 'user', text: 'Draw the path of a request through the cache.' },
          {
            id: 'va',
            role: 'assistant',
            text: '## A request has two paths\n\n```mermaid\nflowchart LR\n  Request --> Cache\n  Cache -->|Hit| Response\n  Cache -->|Miss| Fetch\n  Fetch --> Response\n```\n\n```visual\n<div style="padding:24px;font-family:system-ui"><h3 style="margin-top:0">Cache lifecycle</h3><div style="display:flex;gap:12px;align-items:center"><div class="card" style="padding:16px;border:1px solid #555;border-radius:8px">Read key</div><span>→</span><div class="card" style="padding:16px;border:1px solid #555;border-radius:8px">Check expiry</div><span>→</span><div class="card" style="padding:16px;border:1px solid #555;border-radius:8px">Return or fetch</div></div><p>Expired entries take the same path as a cache miss.</p></div>\n```',
          },
        ],
      }),
    );
    await caption('Diagrams explain relationships at a glance');
    await page.getByRole('region', { name: 'Mermaid diagram' }).locator('svg').waitFor();
    await frame(2600);
    await caption('Sandboxed visuals illustrate the answer inside the thread');
    const visual = page.locator('iframe[title="Visual explanation"]');
    await visual.scrollIntoViewIfNeeded();
    await page
      .frameLocator('iframe[title="Visual explanation"]')
      .getByText('Cache lifecycle')
      .waitFor();
    await frame(3200);
  },
  async planning(g) {
    const { ctx, page, caption, frame, click } = g;
    const thread = session('plan', 'Plan request caching', {
      mode: 'plan',
      plan: {
        text: '# Request caching\n\n## Approach\n\nCache successful GET responses for 30 seconds. Keep errors uncached.\n\n## Implementation\n\n1. Add a cache keyed by request URL.\n2. Check expiration before reusing a response.\n3. Add tests for hits, misses, and expiration.\n\n## Acceptance\n\n- Repeated requests reuse fresh responses.\n- Expired entries trigger a new fetch.\n- Failed requests are never cached.',
        status: 'ready',
        file: '/sample-plans/request-cache.plan.md',
        updatedAt: Date.now(),
      },
      messages: [
        { id: 'pu', role: 'user', text: 'Plan a small request cache before implementing it.' },
      ],
    });
    await show(g, thread);
    await caption('Plan · Review the approach and acceptance checks');
    const plan = page.getByRole('region', { name: 'Plan', exact: true });
    await plan.getByRole('heading', { name: 'Request caching' }).waitFor();
    await frame(2500);
    await caption('Open or edit the ordinary Markdown plan in VS Code');
    await click(plan.getByRole('button', { name: 'Edit plan', exact: true }));
    assert.equal((await ctx.sentOf('editPlan')).at(-1).id, thread.id);
    await caption('Add notes before implementing the latest saved plan');
    await ctx.box.fill('Keep the cache size bounded to 100 entries.');
    await frame(2000);
    await click(
      page
        .getByRole('group', { name: 'Plan choices' })
        .getByRole('button', { name: 'More ways to continue' }),
    );
    await frame(2000);
    await page.keyboard.press('Escape');
    await click(
      page
        .getByRole('group', { name: 'Plan choices' })
        .getByRole('button', { name: 'Implement in Auto', exact: true }),
    );
    assert.equal((await ctx.sentOf('buildPlan')).at(-1).id, thread.id);
    await caption('Implementation requested · Sample UI stops before agent execution');
    await frame(2000);
  },
  async questions(g) {
    const { page, ctx, caption, frame, click } = g;
    await show(
      g,
      session('questions', 'Choose cache behavior', {
        status: 'waiting',
        mode: 'plan',
        approval: {
          id: 'cache-questions',
          title: 'Your input is needed',
          detail: '',
          questions: [
            {
              id: 'ttl',
              prompt: 'How long should responses stay fresh?',
              options: ['30 seconds (Recommended)', '5 minutes'],
            },
            { id: 'notes', prompt: 'Any constraints to keep in mind?', options: [] },
          ],
        },
      }),
    );
    const card = page.getByRole('region', { name: 'Agent questions' });
    await caption('Answer the agent’s questions without leaving the composer');
    await frame(1800);
    await click(card.getByRole('radio', { name: /30 seconds/ }));
    await click(card.getByRole('button', { name: /Continue/ }));
    await caption('Add a written answer when a question needs more detail');
    await card.getByRole('textbox').fill('Keep memory bounded and never cache errors.');
    await frame(2000);
    await card.getByRole('textbox').press('Enter');
    const answer = (await ctx.sentOf('approve')).at(-1);
    assert.equal(answer.answers.ttl, '30 seconds (Recommended)');
    assert.equal(answer.answers.notes, 'Keep memory bounded and never cache errors.');
    const answered = ctx.snapshot.sessions.find((item) => item.id === 'questions');
    assert.ok(answered);
    delete answered.approval;
    answered.status = 'idle';
    await ctx.update(answered.id);
    await card.waitFor({ state: 'detached' });
    await caption('Answers submitted together · Sample stops before agent execution');
    await frame(1800);
  },
  async approvals(g) {
    const { ctx, page, caption, frame, click } = g;
    const thread = session('approval', 'Review a command request', {
      status: 'waiting',
      approval: {
        id: 'test-command',
        title: 'Run the focused cache tests?',
        detail: 'pnpm test --filter request-cache',
      },
    });
    await show(g, thread);
    await caption('Read the requested action before approving it');
    await frame(2200);
    await click(page.getByRole('button', { name: 'Allow once', exact: true }));
    assert.equal((await ctx.sentOf('approve')).at(-1).allowed, true);
    await caption('Allow once approves this request only');
    await frame(1800);
    thread.approval = {
      id: 'remove-cache',
      title: 'Remove the cache fixtures?',
      detail: 'rm -r test/fixtures/cache',
    };
    await ctx.update(thread.id);
    await caption('A different request can be declined');
    await frame(1800);
    await click(page.getByRole('button', { name: 'Decline', exact: true }));
    assert.equal((await ctx.sentOf('approve')).at(-1).allowed, false);
    delete thread.approval;
    thread.status = 'idle';
    await show(g, thread);
    await page.getByRole('button', { name: 'Decline', exact: true }).waitFor({ state: 'detached' });
    await caption('Declined · No command runs in this sample guide');
    await frame(2000);
  },
  async changes(g) {
    const { ctx, page, caption, click, frame } = g;
    await show(
      g,
      session('changes', 'Review request cache changes', {
        messages: [
          { id: 'cu', role: 'user', text: 'Add expiration checks to the request cache.' },
          {
            id: 'ca',
            role: 'assistant',
            text: '## Changes ready for review\n\n- Check expiration before reusing responses.\n- Cover fresh and expired entries in the focused tests.\n\nOpen **Changes** to inspect the checkout.',
          },
        ],
      }),
    );
    await caption('Open Changes to inspect uncommitted files in this checkout');
    await click(page.getByRole('button', { name: 'Toggle changes' }));
    await page.evaluate(() =>
      window.postMessage(
        {
          type: 'changes',
          id: 'changes',
          result: {
            baseline: 'a1b2c3d4e5f6',
            files: [
              {
                path: 'src/request-cache.ts',
                kind: 'update',
                patch: '@@ -1 +1 @@\n-return cache.get(key);\n+return readFreshEntry(key);',
                additions: 1,
                deletions: 1,
              },
              {
                path: 'test/request-cache.test.ts',
                kind: 'add',
                patch: '@@ -0,0 +1 @@\n+test("expired entries are fetched again");',
                additions: 1,
                deletions: 0,
              },
            ],
          },
        },
        '*',
      ),
    );
    await page.getByRole('complementary').getByText('2 files').waitFor();
    await frame(2000);
    await page.getByRole('textbox', { name: 'Search changed files' }).fill('request-cache');
    await frame(1800);
    await caption('Select a file to open VS Code’s Changes editor');
    await click(
      page.getByRole('button', { name: 'Show src/request-cache.ts in the Changes editor' }),
    );
    assert.equal((await ctx.sentOf('reviewChanges')).at(-1).file, 'src/request-cache.ts');
    await caption('Native editor opens in VS Code · Not shown in this webview capture');
    await frame(2200);
  },
  async 'chats-history'(g) {
    const { ctx, page, caption, click, frame } = g;
    await show(g, session('cache', 'Review request caching'), [
      session('tests', 'Add cache tests', { status: 'running' }),
      session('docs', 'Update the README', { status: 'interrupted' }),
    ]);
    await caption('Keep each task in its own tab');
    await click(page.getByRole('button', { name: 'New chat', exact: true }));
    await ctx.box.fill('Draft a release note');
    await frame(1500);
    await click(page.getByRole('button', { name: 'New chat', exact: true }));
    await ctx.box.fill('Check the API docs');
    await frame(1500);
    await click(ctx.tabNamed(/Draft a release note/));
    assert.equal(await ctx.box.getAttribute('data-value'), 'Draft a release note');
    await caption('Switch tabs · Unsent drafts stay with their task');
    await frame(1800);
    await caption('Find older work by searching Chats');
    await ctx.threads.getByPlaceholder('Find a thread…').fill('README');
    await ctx.threads.getByRole('button', { name: /Update the README/ }).waitFor();
    await frame(2000);
    await ctx.threads.getByPlaceholder('Find a thread…').fill('');
    await click(ctx.threads.getByRole('button', { name: 'Running only' }));
    await caption('Running only narrows the list · Interrupted work never restarts itself');
    await frame(2000);
  },
  async context(g) {
    const { ctx, page, caption, click, frame } = g;
    await show(g, session('context', 'Attach the relevant code'));
    await caption('Type @ to browse files, threads, terminals, and more');
    await ctx.box.fill('Explain ');
    await ctx.box.press('End');
    await ctx.box.pressSequentially('@');
    await page.waitForFunction(() =>
      (window as any).sent.some((message: any) => message.type === 'searchContext'),
    );
    const request = (await ctx.sentOf('searchContext')).at(-1);
    await page.evaluate(
      (requestId) =>
        window.postMessage(
          {
            type: 'contextResults',
            requestId,
            recent: ['src/request-cache.ts'],
            matches: [{ kind: 'file', path: 'src/request-cache.ts' }],
            terminals: ['zsh'],
          },
          '*',
        ),
      request.requestId,
    );
    const menu = page.getByRole('listbox', { name: 'Add context' });
    await menu.getByRole('option', { name: /request-cache.ts/ }).waitFor();
    await frame(2200);
    await click(menu.getByRole('option', { name: /request-cache.ts/ }));
    await caption('Selected files stay visible in your draft before sending');
    assert.match((await ctx.box.getAttribute('data-value')) ?? '', /request-cache.ts/);
    await frame(2200);
  },
  async skills(g) {
    const { ctx, page, caption, frame } = g;
    await show(g, session('skills', 'Choose a review skill'));
    Object.assign(ctx.snapshot, {
      skills: {
        codex: {
          status: 'ready',
          skills: [
            {
              name: 'review',
              description: 'Review changes for correctness and missing tests',
              path: '/sample-skills/review/SKILL.md',
              source: 'project',
              enabled: true,
            },
            {
              name: 'docs',
              description: 'Write clear documentation for the current project',
              path: '/sample-skills/docs/SKILL.md',
              source: 'project',
              enabled: true,
            },
          ],
          problems: [],
        },
      },
    });
    await ctx.update('skills');
    await caption('Type / to find skills available to this account');
    await ctx.box.fill('/');
    const menu = page.getByRole('listbox', { name: 'Skills' });
    await menu.waitFor();
    await frame(1800);
    await ctx.box.pressSequentially('rev');
    await frame(1600);
    await ctx.box.press('Enter');
    await ctx.box.fill('Review the request cache changes.');
    await caption('The chip requests a skill · It does not claim the agent used it');
    await page.locator('.composer .attachment-chip', { hasText: 'review' }).waitFor();
    await frame(2200);
    await ctx.box.fill('/');
    await menu.getByText('Manage skills…').dispatchEvent('pointerdown');
    await page.getByRole('dialog', { name: 'Skills' }).waitFor();
    await caption('Browse skills and open their instructions from the Skills panel');
    await frame(2500);
  },
  async subagents(g) {
    const { ctx, page, caption, click, frame } = g;
    const parent = session('parent', 'Review the cache implementation', {
      messages: [
        { id: 'su', role: 'user', text: '@codex Review the cache tests.' },
        {
          id: 'st',
          role: 'tool',
          text: '',
          tool: {
            kind: 'agent',
            name: 'delegate',
            title: 'Review cache tests',
            input: 'Check that the cache tests cover expiration and failed requests.',
            status: 'completed',
            workerId: 'child',
          },
        },
      ],
    });
    const child = session('child', 'Review cache tests', {
      parentId: 'parent',
      delegated: true,
      messages: [
        {
          id: 'sa',
          role: 'assistant',
          text: '## Cache test review\n\nExpiration is covered. Add a regression case confirming that failed requests are never cached.',
        },
      ],
    });
    await show(g, parent, [child]);
    await caption('A subagent’s task and result stay together in a card');
    const result = page.getByRole('button', { name: 'Add this result to your next message' });
    await result.waitFor();
    await frame(2600);
    await click(result);
    await caption('Choose Add this result to carry it into your next message');
    await frame(2200);
    const selected = (await ctx.sentOf('select')).length;
    const earlier = ctx.threads.getByRole('button', { name: /\d+ earlier/ });
    if (await earlier.count()) await click(earlier);
    await click(ctx.threads.getByRole('button', { name: 'Review cache tests', exact: true }));
    assert.ok((await ctx.sentOf('select')).length > selected);
    await ctx.update('child');
    await caption('Open the child thread to inspect its own conversation');
    await frame(2400);
  },
  async handoff(g) {
    const { ctx, page, caption, click, frame } = g;
    await show(g, session('handoff', 'Review request caching'));
    await ctx.box.fill('Review the edge cases from here.');
    const quietBefore = await ctx.quiet();
    await caption('Continue a finished thread with another agent');
    await click(page.locator('main > header').getByRole('button', { name: 'More actions' }));
    await click(page.getByRole('menuitem', { name: 'Continue in Claude Personal', exact: true }));
    const chip = page.getByRole('button', { name: 'Preview Context from Review request caching' });
    await chip.waitFor();
    await caption('Your draft moves with an inspectable context chip');
    await frame(2200);
    await click(chip);
    assert.equal((await ctx.sentOf('previewContext')).at(-1).id, 'handoff');
    await caption('Preview opens in VS Code · Nothing sends until you choose to send');
    await frame(2400);
    assert.equal(await ctx.quiet(), quietBefore);
  },
  async worktrees(g) {
    const { ctx, page, caption, click, frame } = g;
    await caption('Start a task in its own Git worktree');
    await click(page.getByRole('button', { name: /^Location/ }));
    await frame(1600);
    await click(page.getByRole('menuitemradio', { name: /New worktree/ }));
    await ctx.box.fill('Add a bounded request cache.');
    await caption('The location choice applies to this new task');
    await frame(2200);
    await click(page.getByRole('button', { name: /^Location/ }));
    await page.getByRole('menuitemradio', { name: /New worktree/ }).waitFor();
    await caption('Starts from committed HEAD · Uncommitted files are not copied');
    await frame(2600);
    assert.equal(await ctx.quiet(), 0);
  },
  async usage(g) {
    const { page, caption, click, frame } = g;
    await show(
      g,
      session('usage', 'Inspect thread usage', {
        usage: {
          context: { used: 96000, max: 200000 },
          limits: [
            { id: 'primary', label: '5-hour', usedPercent: 31, resetsAt: Date.now() + 8000000 },
            { id: 'secondary', label: 'Weekly', usedPercent: 12, resetsAt: Date.now() + 400000000 },
          ],
          updatedAt: Date.now(),
        },
        runtime: {
          mcpServers: [{ name: 'project-docs', status: 'ready' }],
          instructionFiles: ['AGENTS.md'],
        },
      }),
    );
    await caption('Inspect context and usage reported by the installed CLI');
    await frame(1800);
    await click(page.getByRole('button', { name: 'Context 48% used' }));
    const details = page.getByRole('dialog', { name: 'Thread details' });
    await details.getByText('96K / 200K').waitFor();
    await frame(2200);
    await click(details.getByText('Details', { exact: true }));
    await caption('Expand Details to inspect mode, MCP servers, and instruction files');
    await frame(2600);
  },
};

const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(scenes)) {
  assert.ok(scenes[name], `Unknown scene: ${name}`);
  await captureGuide(`feature-${name}`, async (guide) => {
    await scenes[name](guide);
    await guide.exportClip(name);
  });
}
