import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkVisuals(ctx: UiCheckContext): Promise<void> {
  // Uses the thread/tab state left by tabs; only this section permits expected CSP errors.
  const { page, snapshot, sentOf, update } = ctx;
  // A visual renders in a sandbox: it can draw and animate, and nothing else.
  ctx.browserErrors.expectBlocked = true;
  // Chromium reports a blocked request too, so what counts is whether it was let out.
  const reachedNetwork: string[] = [];
  const blockedReasons: string[] = [];
  await page.route('**://example.test/**', (route) => {
    reachedNetwork.push(route.request().url());
    return route.abort();
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('example.test'))
      blockedReasons.push(`${request.url()} ${request.failure()?.errorText}`);
  });
  const visualHost = snapshot.sessions.find(
    (item) => item.id === 'claude-two',
  ) as unknown as Session;
  visualHost.mode = 'ask';
  visualHost.status = 'running';
  const visualMessage = {
    id: 'visual-test',
    role: 'assistant',
    text: `\`\`\`visual
<div id="hello" class="card fade-in" style="height:320px">Flow <a id="docs" href="https://example.test/docs">docs</a>
<svg viewBox="0 0 40 10" width="200"><line class="dash-flow" x1="0" y1="5" x2="40" y2="5" stroke="currentColor"/></svg></div>
<img id="remote" src="https://example.test/remote.png">
<img src="missing.png" onerror="parent.document.body.dataset.pwned='handler'">
<script>parent.document.body.dataset.pwned='script'</script>
\`\`\``,
    at: Date.now(),
  };
  (visualHost.messages as unknown[]).push({ ...visualMessage, text: '```visual\n<div>half' });
  await update('claude-two');
  await page.getByText('Drawing a visual…').waitFor();
  assert.equal(await page.locator('iframe[title="Visual explanation"]').count(), 0);
  (visualHost.messages as unknown[]).pop();
  (visualHost.messages as unknown[]).push(visualMessage);
  visualHost.status = 'completed';
  await update('claude-two');
  const visual = page.frameLocator('iframe[title="Visual explanation"]');
  await visual.locator('#hello').waitFor();
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="Visual explanation"]') as HTMLElement;
    return frame && frame.getBoundingClientRect().height >= 320;
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.body.dataset.pwned), undefined);
  assert.deepEqual(reachedNetwork, [], 'a visual reaches no network');
  assert.ok(
    blockedReasons.every((reason) => reason.endsWith(' csp')),
    String(blockedReasons),
  );
  assert.equal(
    await visual.locator('#remote').evaluate((image) => (image as HTMLImageElement).naturalWidth),
    0,
  );
  assert.equal(
    await page.locator('iframe[title="Visual explanation"]').getAttribute('sandbox'),
    'allow-same-origin',
  );
  await visual.locator('#docs').click();
  assert.equal((await sentOf('link')).at(-1).href, 'https://example.test/docs');
  await page.screenshot({ path: 'test-results/screenshots/visual.png' });
  (visualHost.messages as unknown[]).pop();
  visualHost.mode = undefined;
  visualHost.status = 'idle';
  ctx.browserErrors.expectBlocked = false;
  await update('planned');
}
