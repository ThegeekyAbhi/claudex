import assert from 'node:assert/strict';
import { captureGuide } from './guide-capture';

await captureGuide(
  'accounts',
  async ({ ctx, page, caption, frame, click, exportClip, resetFrames }) => {
    await caption('1. Open the model selector to manage accounts');
    await click(page.getByRole('button', { name: /^Model:/ }));
    await click(page.getByRole('button', { name: 'Manage account' }));
    const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
    for (const provider of ['claude', 'codex'] as const) {
      const label = provider === 'claude' ? 'Claude Work' : 'Codex Work';
      await caption(`2. Add ${label} with a separate account folder`);
      await click(accounts.getByRole('button', { name: 'Add account', exact: true }));
      const form = accounts.getByRole('form', { name: 'Add account' });
      await click(
        form.getByRole('button', {
          name: provider === 'claude' ? 'Claude Code' : 'Codex',
          exact: true,
        }),
      );
      await form.getByRole('textbox', { name: 'Account name' }).fill(label);
      await frame(1600);
      await click(form.getByRole('button', { name: 'Add account', exact: true }));
      const request = (await ctx.sentOf('profileRequest')).at(-1);
      assert.equal(request.request.provider, provider);
      assert.deepEqual(request.request.folder, { kind: 'new' });
      ctx.snapshot.agents.profiles.push({
        id: request.request.id,
        label,
        provider,
        status: 'ready',
        homeDir: `~/.${provider}-${request.request.id}`,
      });
      Object.assign(ctx.snapshot.catalog, { [request.request.id]: ctx.catalog[provider] });
      await ctx.update();
      await page.evaluate(
        ({ requestId, id }) => window.postMessage({ type: 'profileResult', requestId, id }, '*'),
        { requestId: request.requestId, id: request.request.id },
      );
      await accounts.getByText('Account added. Open the sign-in terminal to connect it.').waitFor();
      await caption('3. Complete sign-in in the CLI terminal before chatting');
      await frame(2200);
    }
    await exportClip('accounts-add');
    await click(page.getByRole('button', { name: 'Close Accounts', exact: true }));
    resetFrames();
    await ctx.box.fill('Review the README structure');
    await caption('Switch between your accounts · Sign-in completed separately');
    await frame();
    await click(page.getByRole('button', { name: /^Model:/ }));
    const rail = page.getByRole('tablist', { name: 'Agents' });
    await caption('Choose Claude Work to see its models');
    await click(rail.getByRole('tab', { name: 'Claude Work', exact: true }));
    await frame(1800);
    await caption('Choose Codex Work, then select a model');
    await click(rail.getByRole('tab', { name: 'Codex Work', exact: true }));
    await frame(1600);
    await click(page.getByRole('option', { name: 'GPT-6.1-Sol' }));
    await caption('Your account is selected. Your draft stays unsent.');
    await frame(2200);
    assert.equal(await ctx.box.getAttribute('data-value'), 'Review the README structure');
    assert.equal(await ctx.quiet(), 0);
    assert.deepEqual(ctx.errors, []);
    await exportClip('accounts-switch');
  },
);
