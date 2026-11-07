import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkThreadFilters(ctx: UiCheckContext): Promise<void> {
  // Uses the completed child-thread fixtures and restored claude-two mode from mode-guides.
  const { page, threads, update } = ctx;
  // Finished subagents wait behind a toggle. Running ones never do.
  await update('planned');
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
  await checkAccountTabs(ctx);
}

/** One tab per account; each shows its threads here and its sessions from the terminal. */
async function checkAccountTabs(ctx: UiCheckContext): Promise<void> {
  const { page, threads, update, snapshot, sentOf } = ctx;
  assert.ok(
    (await sentOf('refreshNativeSessions')).length >= 1,
    'the list asks what the CLIs keep',
  );
  const now = Date.now();
  (snapshot as any).nativeSessions = [
    {
      profileId: 'codex',
      sessionId: 'rollout-1',
      title: 'Fix the flaky test',
      updatedAt: now - 60_000,
    },
    {
      profileId: 'claud2',
      sessionId: 'c2-session',
      title: 'Sketch the parser',
      updatedAt: now - 120_000,
    },
  ];
  await update('planned');
  const tabs = threads.getByRole('tablist', { name: 'Chats by account' });
  assert.deepEqual(await tabs.getByRole('tab').allInnerTexts(), [
    'All',
    'Claude',
    'Claude 2',
    'Codex',
  ]);
  // All shows every account's terminal sessions alongside the threads.
  await threads.getByRole('button', { name: 'Fix the flaky test, from the terminal' }).waitFor();
  await threads.getByRole('button', { name: 'Sketch the parser, from the terminal' }).waitFor();

  await tabs.getByRole('tab', { name: 'Codex' }).click();
  assert.equal(
    await tabs.getByRole('tab', { name: 'Codex' }).getAttribute('aria-selected'),
    'true',
  );
  await threads.getByRole('button', { name: 'Fix the flaky test, from the terminal' }).waitFor();
  assert.equal(await threads.getByRole('button', { name: /Sketch the parser/ }).count(), 0);
  assert.equal(
    await threads.getByRole('button', { name: /Playback review|Plan the cache/ }).count(),
    0,
    'a Claude thread is not under the Codex tab, even the open one',
  );
  await page.screenshot({ path: 'test-results/screenshots/chats-codex-tab.png' });

  // Opening one asks the host to make it a thread here; nothing is sent to an agent.
  const quiet = (await sentOf('start')).length + (await sentOf('send')).length;
  await threads.getByRole('button', { name: 'Fix the flaky test, from the terminal' }).click();
  assert.deepEqual((await sentOf('openNativeSession')).at(-1), {
    type: 'openNativeSession',
    agent: 'codex',
    sessionId: 'rollout-1',
  });
  assert.equal((await sentOf('start')).length + (await sentOf('send')).length, quiet);

  await tabs.getByRole('tab', { name: 'All' }).click();
  await threads.getByRole('button', { name: /Playback review/ }).waitFor();
  delete (snapshot as any).nativeSessions;
  await update('planned');
}
