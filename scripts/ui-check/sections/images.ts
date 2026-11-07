import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkImages(ctx: UiCheckContext): Promise<void> {
  // Uses the planned thread and image messages retained by markdown.
  const { page, sentOf } = ctx;
  // Images: a generated one opens full size; generating and failed states say so.
  await page.getByRole('button', { name: 'View image full size: mock.png' }).click();
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'View image full size: A render cache diagram' }).click();
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor();
  assert.ok(
    await page
      .locator('.lightbox img')
      .evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
    'the image loads under the policy',
  );
  await page.getByRole('button', { name: 'Actual size', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Actual size', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  const viewerBounds = await page.getByRole('dialog', { name: /Image viewer:/ }).boundingBox();
  assert.ok(
    viewerBounds &&
      viewerBounds.x >= 0 &&
      viewerBounds.y >= 0 &&
      viewerBounds.x + viewerBounds.width <= 320 &&
      viewerBounds.y + viewerBounds.height <= 640,
    `image viewer fits narrow panels: ${JSON.stringify(viewerBounds)}`,
  );
  await page.screenshot({ path: 'test-results/screenshots/image-viewer-narrow.png' });
  if (viewport) await page.setViewportSize(viewport);
  await page.screenshot({ path: 'test-results/screenshots/image-viewer.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View image full size: A render cache diagram' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Fit', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByText('Generating image…').waitFor();
  await page.getByText('Codex reached its image generation limit.').waitFor();
  await page.getByRole('button', { name: 'Reveal' }).click();
  assert.deepEqual((await sentOf('openImage')).at(-1), {
    type: 'openImage',
    file: 'sample.png',
    reveal: true,
  });
  await page.screenshot({ path: 'test-results/screenshots/images.png' });
}
