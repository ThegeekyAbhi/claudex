import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkChanges(ctx: UiCheckContext): Promise<void> {
  // Returns from the worker selected by terminal-drafts.
  const { page, patch, sentOf, update } = ctx;
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
}
