import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkAttachments(ctx: UiCheckContext): Promise<void> {
  // Uses the idle claude-two composer selected by context-menu.
  const { page, box, sentOf } = ctx;
  // Pasting an image sends it to the host, which replies with a stored file.
  await box.fill('Keep my words');
  await box.focus();
  await box.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5));
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('textarea')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
  });
  await page.waitForFunction(() =>
    (window as any).sent.some((message: any) => message.type === 'attachImage'),
  );
  assert.equal((await sentOf('attachImage')).at(-1).name, 'shot.png');
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: { kind: 'image', file: 'sample.png', name: 'shot.png' },
      },
      '*',
    ),
  );
  const thumbnail = page.locator('.composer .attachment-image');
  await thumbnail.locator('img').waitFor();
  assert.equal(await box.inputValue(), 'Keep my words');
  assert.equal(await box.evaluate((element: HTMLTextAreaElement) => element.selectionStart), 5);
  assert.equal(await thumbnail.innerText(), '');
  const previewButton = thumbnail.getByRole('button', { name: /View image full size/ });
  assert.equal(
    await previewButton.evaluate((element) => getComputedStyle(element).cursor),
    'zoom-in',
  );
  const dimensions = await previewButton.boundingBox();
  assert.ok(dimensions && dimensions.width >= 90 && dimensions.height >= 70);
  await previewButton.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: /Image viewer:/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (element) => document.activeElement === element,
    await previewButton.elementHandle(),
  );
  await previewButton.click();
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: { kind: 'image', file: 'sample-2.png', name: 'second.png' },
      },
      '*',
    ),
  );
  await page.locator('.composer .attachment-image').nth(1).locator('img').waitFor();
  assert.equal(await box.inputValue(), 'Keep my words');
  await box.press('Enter');
  await page.waitForFunction(() =>
    (window as any).sent.some(
      (message: any) =>
        message.type === 'send' &&
        message.text === 'Keep my words' &&
        message.attachments?.length === 2,
    ),
  );
  assert.deepEqual(
    (await sentOf('send')).at(-1).attachments.map((item: any) => item.name),
    ['shot.png', 'second.png'],
  );
  await page.getByRole('button', { name: /Remove .*shot.png/ }).click();
  await page.getByRole('button', { name: /Remove second.png/ }).click();
  await page.evaluate(() =>
    window.postMessage({ type: 'sent', id: 'claude-two', text: 'Keep my words' }, '*'),
  );
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: { kind: 'image', file: 'missing.png', name: 'missing.png' },
      },
      '*',
    ),
  );
  await page.getByText('Image unavailable', { exact: true }).waitFor();
  assert.ok(
    await page.getByRole('button', { name: 'View image full size: missing.png' }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Remove missing.png', exact: true }).click();
}
