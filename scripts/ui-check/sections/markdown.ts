import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkMarkdown(ctx: UiCheckContext): Promise<void> {
  // Adds a diagram to the planned thread created by plan.
  const { page, snapshot, update, sentOf } = ctx;
  const diagramSession = snapshot.sessions.find((item) => item.id === 'planned');
  assert.ok(diagramSession);
  diagramSession.status = 'completed';
  diagramSession.approval = undefined;
  (diagramSession as unknown as Session).messages.push({
    id: 'diagram-test',
    role: 'assistant',
    text: '```bash\ncargo bench-ui\n```\n\n```mermaid\nflowchart LR\n A[Plan] --> B[Worker]\n```',
    at: Date.now(),
  } as any);
  await update('planned');
  const codeBlock = page.locator('.code-block').filter({ hasText: 'cargo bench-ui' });
  const codeCopy = codeBlock.getByRole('button', { name: 'Copy code', exact: true });
  await codeCopy.click();
  const request = (await sentOf('copy')).at(-1);
  assert.equal(request.text, 'cargo bench-ui');
  assert.ok(request.requestId);
  assert.equal(await codeCopy.getAttribute('data-copied'), 'false');
  await page.evaluate(
    (requestId) => window.postMessage({ type: 'copyResult', requestId, ok: true }, '*'),
    request.requestId,
  );
  const confirmation = codeBlock.getByRole('button', { name: 'Copied code', exact: true });
  await confirmation.waitFor();
  await page.waitForFunction(() => {
    const check = document.querySelector('.code-copy[data-copied="true"] .check-glyph');
    return check && getComputedStyle(check).opacity === '1';
  });
  await confirmation.waitFor({ state: 'hidden' });
  const region = page.getByRole('region', { name: 'Mermaid diagram' });
  const diagram = region.locator('.diagram-viewer-stage > svg');
  await diagram.waitFor();
  // The drawing zooms from the toolbar, shows actual size from the readout, and fits again.
  const stage = region.locator('.diagram-viewer-stage');
  const readout = region.getByRole('button', { name: 'Zoom level; show actual size' });
  const fitted = await readout.textContent();
  await region.getByRole('button', { name: 'Zoom in (+)' }).click();
  assert.notEqual(await readout.textContent(), fitted);
  assert.match((await stage.getAttribute('style')) ?? '', /scale\(/);
  await readout.click();
  assert.equal(await readout.textContent(), '100%');
  await region.getByRole('button', { name: 'Fit (1)' }).click();
  assert.equal(await readout.textContent(), fitted);
  // Expanding opens a modal with its own copy; Escape closes it.
  await region.getByRole('button', { name: 'Expand' }).click();
  const expanded = page.getByRole('dialog', { name: 'Expanded diagram' });
  await expanded.locator('.diagram-viewer-stage > svg').waitFor();
  await page.keyboard.press('Escape');
  await expanded.waitFor({ state: 'detached' });
  const initialDiagram = await diagram.getAttribute('id');
  await page.evaluate(() => {
    document.body.style.setProperty('--vscode-editor-background', '#fbfaf7');
    document.body.style.setProperty('--vscode-foreground', '#202020');
    document.body.style.setProperty('--vscode-input-background', '#eeeeee');
    document.body.style.setProperty('--vscode-panel-border', '#555555');
  });
  await page.waitForFunction((id) => {
    const svg = document.querySelector(
      '[aria-label="Mermaid diagram"] .diagram-viewer-stage > svg',
    );
    return svg && svg.id !== id;
  }, initialDiagram);
  assert.match(await diagram.innerHTML(), /#202020/);
  await page.evaluate(() => {
    for (const key of ['editor-background', 'foreground', 'input-background', 'panel-border'])
      document.body.style.removeProperty(`--vscode-${key}`);
  });
}
