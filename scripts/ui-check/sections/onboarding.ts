import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

/** Posts a workspace with no threads, the state a first install starts in. */
async function firstRun(ctx: UiCheckContext, profiles: unknown[], dismissed = false) {
  await ctx.page.evaluate(
    ({ profiles, dismissed }) =>
      window.postMessage(
        {
          type: 'snapshot',
          snapshot: {
            sessions: [],
            project: 'fresh-project',
            trusted: true,
            documents: [],
            agents: { profiles, problems: [], suggestions: [] },
            onboardingDismissed: dismissed,
          },
        },
        '*',
      ),
    { profiles, dismissed },
  );
}

export async function checkOnboarding(ctx: UiCheckContext): Promise<void> {
  // Runs last: it replaces the fixture threads with an empty workspace.
  const { page, errors, sentOf, box } = ctx;
  const claude = { id: 'claude', label: 'Claude', provider: 'claude', builtin: true };
  const codex = { id: 'codex', label: 'Codex', provider: 'codex', builtin: true };
  const personal = { id: 'personal', label: 'Personal', provider: 'claude', homeDir: '/p' };
  const second = { id: 'second', label: 'Second', provider: 'claude', homeDir: '/s' };
  const signedIn = { status: 'ready', version: '2.1.42', auth: { state: 'signedIn' } };
  const signedOut = { status: 'ready', version: '2.1.42', auth: { state: 'signedOut' } };
  const home = page.getByRole('region', { name: 'Get started' });
  const setup = page.getByRole('region', { name: 'Set up Claudex' });
  const strip = home.getByRole('button', { name: /Manage accounts/ });

  // Already signed in everywhere: no setup at all, just a greeting, ideas and a quiet account line.
  await firstRun(ctx, [
    { ...claude, ...signedIn, auth: { state: 'signedIn', method: 'Claude account', plan: 'Pro' } },
    { ...codex, ...signedIn, auth: { state: 'signedIn', method: 'ChatGPT' } },
    { ...personal, ...signedIn },
    { ...second, ...signedIn },
  ]);
  await home.getByRole('heading', { name: 'What should we build in fresh-project?' }).waitFor();
  assert.equal(await setup.count(), 0, 'no setup card once signed in');
  assert.equal(
    await page.getByRole('button', { name: /Sign in/ }).count(),
    0,
    'nothing to sign in',
  );
  assert.match((await strip.textContent()) ?? '', /4 accounts ready/);
  assert.equal(
    await home.locator('[data-auth="signedIn"]').first().getAttribute('title'),
    'Claude Code · Signed in with Claude account · Pro',
  );
  // The ideas sit in one even row, with nothing orphaned.
  const tops = await home
    .locator('.starter-prompt')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, 'starter prompts share one row');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/screenshots/onboarding.png' });

  // A starter prompt fills the message box and sends nothing.
  const sendsBefore = (await sentOf('start')).length;
  await home.getByRole('button', { name: 'Explore this project' }).click();
  assert.match(
    (await box.getAttribute('data-value')) ?? '',
    /^Explain how this project is structured/,
  );
  assert.equal((await sentOf('start')).length, sendsBefore);
  await box.fill('');

  await page.setViewportSize({ width: 380, height: 760 });
  assert.ok(
    await home.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    'the greeting fits a narrow panel',
  );
  await page.screenshot({ path: 'test-results/screenshots/onboarding-narrow.png' });
  await page.setViewportSize({ width: 1440, height: 960 });

  // One account signed out: the line says so, and opens that account to sign in.
  await firstRun(ctx, [
    { ...claude, ...signedIn },
    { ...codex, ...signedOut },
  ]);
  await strip.getByText('1 needs sign-in').waitFor();
  await strip.click();
  const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
  await accounts.getByText('Signed out', { exact: true }).first().waitFor();
  await accounts.getByRole('button', { name: 'Open sign-in terminal' }).click();
  const request = (await sentOf('profileRequest')).at(-1);
  assert.deepEqual(request.request, { operation: 'signIn', id: 'codex' });
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'codex' }, '*'),
    request.requestId,
  );
  await accounts.getByText(/Sign-in terminal opened/).waitFor();
  await page.getByRole('button', { name: 'Close Accounts', exact: true }).click();

  // An unknown answer is never shown as signed out.
  await firstRun(ctx, [
    { ...claude, status: 'ready', auth: { state: 'unknown' } },
    { ...codex, status: 'missingCli' },
  ]);
  await strip.getByText('1 account', { exact: true }).waitFor();
  assert.equal(await strip.getByText(/sign-in/).count(), 0);

  // Every installed agent signed out: sign in, in the CLI's own terminal, or skip.
  await firstRun(ctx, [
    { ...claude, ...signedOut },
    { ...codex, status: 'missingCli', problem: 'codex was not found on PATH.' },
  ]);
  await setup.getByRole('heading', { name: 'Sign in to start' }).waitFor();
  assert.equal(await setup.getByRole('listitem').count(), 1, 'only installed agents are listed');
  await page.screenshot({ path: 'test-results/screenshots/onboarding-sign-in.png' });
  await setup.getByRole('button', { name: 'Sign in to Claude Code' }).click();
  assert.deepEqual((await sentOf('signInProfile')).at(-1), { type: 'signInProfile', id: 'claude' });
  await setup.getByText('Finish in the terminal').waitFor();
  const refreshes = (await sentOf('refreshAgents')).length;
  await setup.getByRole('button', { name: 'Check again' }).click();
  assert.equal((await sentOf('refreshAgents')).length, refreshes + 1);
  await setup.getByRole('button', { name: 'Skip for now' }).click();
  assert.deepEqual(await sentOf('dismissOnboarding'), [{ type: 'dismissOnboarding' }]);
  await firstRun(
    ctx,
    [
      { ...claude, ...signedOut },
      { ...codex, status: 'missingCli' },
    ],
    true,
  );
  await home.waitFor();
  await setup.waitFor({ state: 'detached' });

  // With nothing installed, setup returns even dismissed, and can't be skipped.
  await firstRun(
    ctx,
    [
      { ...claude, status: 'missingCli' },
      { ...codex, status: 'missingCli' },
    ],
    true,
  );
  await setup.getByText('Install an agent to start').waitFor();
  assert.equal(await setup.getByRole('button', { name: 'Skip for now' }).count(), 0);
  await setup.getByText('npm install -g @anthropic-ai/claude-code').waitFor();
  await setup.getByRole('button', { name: 'Codex' }).click();
  await setup.getByText('npm install -g @openai/codex').waitFor();
  assert.equal(await setup.getByRole('button', { name: 'Copy install command' }).count(), 1);
  await page.screenshot({ path: 'test-results/screenshots/onboarding-install.png' });
  const beforeInstall = (await sentOf('refreshAgents')).length;
  await setup.getByRole('button', { name: 'I’ve installed it' }).click();
  assert.equal((await sentOf('refreshAgents')).length, beforeInstall + 1);
  assert.deepEqual(errors, []);
}
