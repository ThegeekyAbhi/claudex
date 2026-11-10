import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkImages(ctx: UiCheckContext): Promise<void> {
  // Uses the planned thread and image messages retained by markdown.
  const { page, sentOf } = ctx;
  // Images: a generated one opens full size; generating and failed states say so.
  await page.getByRole('button', { name: 'View image full size: mock.png' }).click();
  assert.equal((await sentOf('openImage')).at(-1).type, 'openImage');
  const generated = page.getByRole('button', {
    name: 'View image full size: A render cache diagram',
  });
  assert.ok(
    await generated.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
  );
  await generated.click();
  assert.deepEqual((await sentOf('openImage')).at(-1), { type: 'openImage', file: 'sample.png' });
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
