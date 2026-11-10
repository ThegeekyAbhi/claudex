import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkProfiles(ctx: UiCheckContext): Promise<void> {
  // Uses the planned thread restored after removing the continuation fixtures.
  const { page, snapshot, box, sentOf, update } = ctx;
  // Profiles come from what the host found. A CLI that isn't installed stays listed but dimmed,
  // has no models to pick, and can't be mentioned; one you added shows with its own name.
  const savedAgents = snapshot.agents;
  snapshot.agents = {
    profiles: [
      { id: 'claude', label: 'Claude', provider: 'claude', builtin: true, status: 'ready' },
      {
        id: 'claude-work',
        label: 'Work',
        provider: 'claude',
        homeDir: '~/.claude-work',
        status: 'ready',
      },
      {
        id: 'codex',
        label: 'Codex',
        provider: 'codex',
        builtin: true,
        status: 'missingCli',
        problem: 'Codex isn’t installed, or isn’t on the PATH VS Code sees.',
      },
    ],
    problems: [],
    suggestions: [],
  };
  await update(undefined);
  await box.fill('Keep this draft');
  await page.getByRole('button', { name: /^Model:/ }).click();
  const profileRail = page.getByRole('tablist', { name: 'Agents' });
  assert.deepEqual(
    await profileRail
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))),
    ['Claude', 'Work', 'Codex'],
    'the rail lists the profiles the host reported, and no Claude 2',
  );
  await profileRail.getByRole('tab', { name: 'Codex', exact: true }).click();
  await page.getByText('Not installed').waitFor();
  assert.equal(await page.getByRole('option', { name: 'GPT-6.1-Sol' }).count(), 0);
  await profileRail.getByRole('tab', { name: 'Work', exact: true }).click();
  await page.getByText('@claude-work').waitFor();
  await page.screenshot({ path: 'test-results/screenshots/profiles.png' });
  await page.getByRole('button', { name: 'Manage account' }).click();
  const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
  await accounts.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Accounts', exact: true }).count(), 1);
  await update(undefined);
  await accounts.getByRole('button', { name: 'Rename', exact: true }).click();
  await accounts.getByRole('textbox', { name: 'Account name' }).fill('Work renamed');
  await accounts.getByRole('button', { name: 'Save name' }).click();
  const rename = (await sentOf('profileRequest')).at(-1);
  assert.deepEqual(rename.request, {
    operation: 'rename',
    id: 'claude-work',
    name: 'Work renamed',
  });
  await page.evaluate(
    (requestId) =>
      window.postMessage(
        { type: 'profileResult', requestId, error: 'Could not save settings.' },
        '*',
      ),
    rename.requestId,
  );
  await accounts.getByRole('alert').getByText('Could not save settings.').waitFor();
  assert.equal(
    await accounts.getByRole('textbox', { name: 'Account name' }).inputValue(),
    'Work renamed',
  );
  await accounts.getByRole('button', { name: 'Save name' }).click();
  const retry = (await sentOf('profileRequest')).at(-1);
  // An old response must not settle a new request.
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'claude-work' }, '*'),
    rename.requestId,
  );
  assert.equal(await accounts.getByRole('button', { name: 'Save name' }).isDisabled(), true);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'claude-work' }, '*'),
    retry.requestId,
  );
  await accounts.getByText('Account renamed.').waitFor();
  await accounts.getByRole('button', { name: 'Add account', exact: true }).click();
  const form = accounts.getByRole('form', { name: 'Add account' });
  await form.getByRole('textbox', { name: 'Account name' }).fill('Personal');
  await form.getByLabel('Account folder', { exact: true }).selectOption('picked');
  await form.getByRole('button', { name: 'Browse' }).click();
  const pick = (await sentOf('profileRequest')).at(-1);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, cancelled: true }, '*'),
    pick.requestId,
  );
  await form.getByText('Choose the folder for this account.').waitFor();
  assert.equal(
    await form.getByRole('button', { name: 'Add account', exact: true }).isDisabled(),
    true,
  );
  await form.getByLabel('Account folder', { exact: true }).selectOption('new');
  await form.getByRole('button', { name: 'Add account', exact: true }).click();
  const create = (await sentOf('profileRequest')).at(-1);
  assert.deepEqual(create.request, {
    operation: 'create',
    provider: 'claude',
    name: 'Personal',
    id: 'personal',
    folder: { kind: 'new' },
  });
  assert.equal(await form.getByRole('button', { name: 'Saving…' }).isDisabled(), true);
  await page.evaluate(
    (requestId) =>
      window.postMessage({ type: 'profileResult', requestId, error: 'Disk full. Try again.' }, '*'),
    create.requestId,
  );
  await accounts.getByRole('alert').getByText('Disk full. Try again.').waitFor();
  assert.equal(await form.getByRole('textbox', { name: 'Account name' }).inputValue(), 'Personal');
  await page.screenshot({ path: 'test-results/screenshots/account-setup.png' });
  const viewport = page.viewportSize();
  for (const width of [320, 400]) {
    await page.setViewportSize({ width, height: 800 });
    const bounds = await form.boundingBox();
    assert.ok(
      bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
      'account setup fits a sidebar',
    );
    assert.equal(
      await form.evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
    );
    await page.screenshot({ path: `test-results/screenshots/account-setup-${width}.png` });
  }
  await page.evaluate(() => {
    document.body.className = 'vscode-light';
    document.documentElement.dataset.appearance = 'editor';
  });
  await page.screenshot({ path: 'test-results/screenshots/account-setup-light.png' });
  await page.evaluate(() => {
    document.body.className = '';
    document.documentElement.dataset.appearance = 'cursor';
  });
  if (viewport) await page.setViewportSize(viewport);
  await form.getByRole('button', { name: 'Add account', exact: true }).click();
  const saved = (await sentOf('profileRequest')).at(-1);
  snapshot.agents.profiles.push({
    id: 'personal',
    label: 'Personal',
    provider: 'claude',
    homeDir: '~/.claude-personal',
    status: 'ready',
  });
  await update(undefined);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'personal' }, '*'),
    saved.requestId,
  );
  await accounts.getByText('Account added. Open the sign-in terminal to connect it.').waitFor();
  await accounts.getByRole('button', { name: 'Open sign-in terminal' }).waitFor();
  // Removal needs a deliberate confirmation, and never removes the CLI's account files.
  await accounts.getByRole('button', { name: 'Remove', exact: true }).click();
  await accounts.getByRole('button', { name: 'Remove account', exact: true }).click();
  const removed = (await sentOf('profileRequest')).at(-1);
  assert.deepEqual(removed.request, { operation: 'remove', id: 'personal' });
  snapshot.agents.profiles = snapshot.agents.profiles.filter(
    (item) => (item as { id: string }).id !== 'personal',
  );
  await update(undefined);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'personal' }, '*'),
    removed.requestId,
  );
  await accounts.getByText('Account removed. Its files were kept.').waitFor();
  await accounts.getByRole('button', { name: /Work @claude-work/ }).click();

  await accounts.getByRole('button', { name: 'Open sign-in terminal' }).click();
  const login = (await sentOf('profileRequest')).at(-1);
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'profileResult', requestId, id: 'claude-work' }, '*'),
    login.requestId,
  );
  await accounts.getByText(/Sign-in terminal opened for Work/).waitFor();
  await accounts.getByRole('button', { name: 'Remove', exact: true }).click();
  await accounts.getByRole('group', { name: 'Confirm account removal' }).waitFor();
  await accounts.getByRole('button', { name: 'Keep account' }).click();
  await page.screenshot({ path: 'test-results/screenshots/accounts.png' });
  // Switching tabs keeps both the setup page and the unsent chat intact.
  await page.getByRole('button', { name: 'Close Accounts', exact: true }).click();
  assert.equal(await box.getAttribute('data-value'), 'Keep this draft');
  await box.fill('@c');
  await page.getByRole('option', { name: /@claude-work/ }).waitFor();
  assert.equal(await page.getByRole('option', { name: /@claude2/ }).count(), 0);
  assert.equal(await page.getByRole('option', { name: /@codex/ }).count(), 0);
  await box.fill('');
  snapshot.agents = savedAgents;
  await update('planned');
}
