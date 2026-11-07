import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkUsage(ctx: UiCheckContext): Promise<void> {
  // Inspects the asking thread created and selected by questions.
  const { page, update } = ctx;
  // Usage: a quiet ring with the CLI's own numbers, and a way forward when nearly full.
  const ring = page.getByRole('button', { name: 'Context 88% used' });
  assert.match(await ring.innerText(), /Ctx 88%/);
  assert.match(await ring.innerText(), /Week/);
  await ring.hover();
  const usageCard = page.getByRole('dialog', { name: 'Thread details' });
  await usageCard.getByText('176K / 200K').waitFor();
  await usageCard.getByText(/^Weekly/).waitFor();
  assert.equal(await usageCard.getByText('Expired').count(), 0, 'an elapsed window is not shown');
  await usageCard.getByRole('button', { name: 'Hand off to another agent' }).waitFor();
  // The card is also the inspector: what the CLI reported, and a failed MCP server gets a dot.
  assert.equal(await usageCard.getByText('Mode').isVisible(), false);
  await page.screenshot({ path: 'test-results/screenshots/usage-compact.png' });
  await usageCard.getByText('Details', { exact: true }).click();
  await usageCard.getByText('Mode', { exact: true }).waitFor();
  await usageCard.getByText('figma: failed').first().waitFor();
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
}
