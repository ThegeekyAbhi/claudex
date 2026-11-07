import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

/** Posts a workspace with no threads, the state a first install starts in. */
async function firstRun(ctx: UiCheckContext, agents: unknown, dismissed = false) {
  await ctx.page.evaluate(
    ({ agents, dismissed }) =>
      window.postMessage(
        {
          type: 'snapshot',
          snapshot: {
            sessions: [],
            project: 'fresh-project',
            trusted: true,
            documents: [],
            agents,
            onboardingDismissed: dismissed,
          },
        },
        '*',
      ),
    { agents, dismissed },
  );
}

export async function checkOnboarding(ctx: UiCheckContext): Promise<void> {
  // Runs last: it replaces the fixture threads with an empty workspace.
  const { page, errors, sentOf, box } = ctx;
  const claude = { id: 'claude', label: 'Claude', provider: 'claude', builtin: true };
  const codex = { id: 'codex', label: 'Codex', provider: 'codex', builtin: true };
  const card = page.getByRole('region', { name: 'Set up Claudex' });

  // One agent installed: its status, sign-in, the other's install command, and starter prompts.
  await firstRun(ctx, {
    profiles: [
      { ...claude, status: 'ready', version: '2.1.42' },
      { ...codex, status: 'missingCli', problem: 'codex was not found on PATH.' },
    ],
    problems: [],
    suggestions: [],
  });
  await card.waitFor();
  await card.getByText('CLI installed').waitFor();
  await card.getByText('Not installed').waitFor();
  // The missing CLI's install command is shown inline, with a copy button.
  await card.getByText('npm install -g @openai/codex').waitFor();
  assert.equal(await card.getByRole('button', { name: 'Copy install command' }).count(), 1);
  // Installation is the only step this extension can verify; sign-in is never marked done.
  const steps = card.getByRole('list', { name: 'Setup steps' }).getByRole('listitem');
  assert.equal(await steps.nth(0).getAttribute('data-state'), 'done');
  assert.equal(await steps.nth(1).getAttribute('data-state'), 'current');
  assert.equal(await card.getByText(/signed in/i).count(), 0, 'installed is not signed in');
  await page.screenshot({ path: 'test-results/screenshots/onboarding.png' });

  await card.getByRole('button', { name: 'Sign in' }).click();
  const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
  await accounts.getByRole('button', { name: 'Open sign-in terminal' }).click();
  const request = (await sentOf('profileRequest')).at(-1);
  assert.deepEqual(request.request, { operation: 'signIn', id: 'claude' });
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'claude' }, '*'),
    request.requestId,
  );
  await accounts.getByText(/Sign-in terminal opened/).waitFor();
  await page.getByRole('button', { name: 'Close Accounts', exact: true }).click();
  await card.getByRole('button', { name: 'Check again' }).click();
  assert.equal((await sentOf('refreshAgents')).length, 1);

  // A starter prompt fills the message box and sends nothing.
  const sendsBefore = (await sentOf('start')).length;
  await card.getByRole('button', { name: 'Explore this project' }).click();
  assert.match(await box.inputValue(), /^Explain how this project is structured/);
  assert.equal((await sentOf('start')).length, sendsBefore);
  await box.fill('');

  await card.getByRole('button', { name: 'Don’t show again' }).click();
  assert.deepEqual(await sentOf('dismissOnboarding'), [{ type: 'dismissOnboarding' }]);
  await firstRun(
    ctx,
    { profiles: [{ ...claude, status: 'ready' }], problems: [], suggestions: [] },
    true,
  );
  await card.waitFor({ state: 'detached' });

  // With nothing installed the card returns, even dismissed, and can't be closed.
  await firstRun(
    ctx,
    {
      profiles: [
        { ...claude, status: 'missingCli' },
        { ...codex, status: 'missingCli' },
      ],
      problems: [],
      suggestions: [],
    },
    true,
  );
  await card.getByText('Install an agent to start').waitFor();
  assert.equal(await card.getByRole('button', { name: 'Don’t show again' }).count(), 0);
  assert.deepEqual(errors, []);
}
