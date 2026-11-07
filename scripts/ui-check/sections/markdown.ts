import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkMarkdown(ctx: UiCheckContext): Promise<void> {
  // Adds a diagram to the planned thread created by plan.
  const { page, snapshot, update } = ctx;
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
}
