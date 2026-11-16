import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkAttachments(ctx: UiCheckContext): Promise<void> {
  // Uses the idle claude-two composer selected by context-menu.
  const { page, box, sentOf } = ctx;
  // Pasting an image sends it to the host, which replies with a stored file.
  await box.fill('Keep my words');
  await box.focus();
  await box.evaluate((element) => {
    const range = document.createRange();
    if (!element.firstChild) throw new Error('Missing editor text');
    range.setStart(element.firstChild, 5);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('.composer-input')
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
        attachment: {
          kind: 'image',
          file: '00000000-0000-4000-8000-000000000001.png',
          name: 'shot.png',
        },
      },
      '*',
    ),
  );
  const thumbnail = page.locator('.composer .attachment-image');
  await thumbnail.locator('img').waitFor();
  assert.equal(await box.getAttribute('data-value'), 'Keep [Image #1] my words');
  assert.equal(
    await box.evaluate((element) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      if (!selection?.anchorNode) throw new Error('Missing caret');
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return range.toString().length;
    }),
    16,
  );
  assert.equal(await thumbnail.innerText(), '');
  const previewButton = thumbnail.getByRole('button', { name: /View image full size/ });
  assert.equal(
    await previewButton.evaluate((element) => getComputedStyle(element).cursor),
    'zoom-in',
  );
  const dimensions = await previewButton.boundingBox();
  assert.ok(dimensions && dimensions.width <= 80 && dimensions.height === 56);
  await previewButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    (window as any).sent.some(
      (message: any) =>
        message.type === 'openImage' && message.file === '00000000-0000-4000-8000-000000000001.png',
    ),
  );
  await box.fill('Keep my words');
  assert.equal(await thumbnail.count(), 0);
  await box.press('ControlOrMeta+z');
  await thumbnail.waitFor();
  assert.equal(await box.getAttribute('data-value'), 'Keep [Image #1] my words');
  await box.press('ControlOrMeta+Shift+z');
  assert.equal(await thumbnail.count(), 0);
  await box.press('ControlOrMeta+z');
  await thumbnail.waitFor();
  await box.evaluate((element) => {
    const range = document.createRange();
    if (!element.firstChild) throw new Error('Missing editor text');
    range.setStart(element.firstChild, 16);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: {
          kind: 'image',
          file: '00000000-0000-4000-8000-000000000002.png',
          name: 'second.png',
        },
      },
      '*',
    ),
  );
  await page.locator('.composer .attachment-image').nth(1).locator('img').waitFor();
  assert.equal(await box.getAttribute('data-value'), 'Keep [Image #1] [Image #2] my words');
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'attached',
        draftKey: 'claude-two',
        attachment: {
          kind: 'thread',
          id: 'long-context',
          title: 'A very long context title '.repeat(20),
          history: 'recent',
        },
      },
      '*',
    ),
  );
  const contextChip = page
    .locator('.composer .attachment-chip')
    .filter({ hasText: 'A very long context title' });
  await contextChip.waitFor();
  const chipBounds = await contextChip.boundingBox();
  const imageBounds = await thumbnail.first().boundingBox();
  assert.ok(chipBounds && imageBounds);
  assert.ok(chipBounds.width <= 221, 'long context stays inside its chip');
  assert.ok(
    chipBounds.x >= imageBounds.x + imageBounds.width ||
      chipBounds.y >= imageBounds.y + imageBounds.height,
    'context and image do not overlap',
  );
  await contextChip.getByRole('button', { name: /Remove Context/ }).click();
  await box.press('Enter');
  await page.waitForFunction(() =>
    (window as any).sent.some(
      (message: any) =>
        message.type === 'send' &&
        message.text === 'Keep [Image #1] [Image #2] my words' &&
        message.attachments?.length === 2,
    ),
  );
  assert.deepEqual(
    (await sentOf('send')).at(-1).attachments.map((item: any) => item.name),
    ['shot.png', 'second.png'],
  );
  assert.deepEqual(
    (await sentOf('send')).at(-1).attachments.map((item: any) => item.reference),
    [1, 2],
  );
  await page.getByRole('button', { name: /Remove .*shot.png/ }).click();
  await page.getByRole('button', { name: /Remove .*second.png/ }).click();
  assert.equal(
    await box.getAttribute('data-value'),
    'Keep my words',
    'removing images clears their inline references',
  );
  await page.evaluate(() =>
    window.postMessage(
      { type: 'sent', id: 'claude-two', text: 'Keep [Image #1] [Image #2] my words' },
      '*',
    ),
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
    await page
      .getByRole('button', { name: 'View image full size: [Image #1] missing.png' })
      .isDisabled(),
  );
  await page.getByRole('button', { name: 'Remove [Image #1] missing.png', exact: true }).click();
  await box.fill('Many images');
  const addImages = async (start: number, count: number) => {
    await page.evaluate(
      ({ start, count }) => {
        for (let index = start; index < start + count; index++)
          window.postMessage(
            {
              type: 'attached',
              draftKey: 'claude-two',
              attachment: {
                kind: 'image',
                file: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}.png`,
                name: 'image.png',
              },
            },
            '*',
          );
      },
      { start, count },
    );
  };
  await addImages(10, 1);
  await page.locator('.composer .attachment-image').waitFor();
  const strip = page.locator('.composer-images');
  const oneHeight = await strip.evaluate((element) => element.getBoundingClientRect().height);
  await addImages(11, 15);
  await page.waitForFunction(
    () => document.querySelectorAll('.composer .attachment-image').length === 16,
  );
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.equal(
      await strip.evaluate((element) => element.getBoundingClientRect().height),
      oneHeight,
    );
    assert.ok(
      await strip.evaluate((element) => element.scrollWidth > element.clientWidth),
      JSON.stringify(
        await strip.evaluate((element) => ({
          width: element.clientWidth,
          scroll: element.scrollWidth,
          card: element.firstElementChild?.getBoundingClientRect().width,
        })),
      ),
    );
    assert.equal(await page.locator('.composer .attachment-image').first().innerText(), '');
  }
  await addImages(26, 15);
  await page.waitForFunction(
    () => document.querySelectorAll('.composer .attachment-image').length === 30,
  );
  await page.getByText(/You can attach up to 30 items per message/).waitFor();
  assert.equal(await page.locator('.composer .attachment-image').count(), 30);
  assert.ok(!(await box.getAttribute('data-value'))?.includes('[Image #31]'));
  const lastImage = page.locator('.composer .attachment-image').last();
  await lastImage.getByRole('button', { name: /Remove/ }).click();
  assert.ok(!(await box.getAttribute('data-value'))?.includes('[Image #30]'));
  assert.ok((await box.getAttribute('data-value'))?.includes('[Image #29]'));
  while (await page.locator('.composer .attachment-image').count())
    await page
      .locator('.composer .attachment-image')
      .last()
      .getByRole('button', { name: /Remove/ })
      .click();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await box.fill('');
  await checkDelayedAcknowledgements(ctx);
}

async function checkDelayedAcknowledgements(ctx: UiCheckContext): Promise<void> {
  const { page, box, sentOf, update } = ctx;
  await update('claude-two');
  const attach = async (file: string) => {
    await page.evaluate(
      (file) =>
        window.postMessage(
          {
            type: 'attached',
            draftKey: 'claude-two',
            attachment: { kind: 'image', file, name: file },
          },
          '*',
        ),
      file,
    );
  };
  const acknowledge = async (submission: any) => {
    await page.evaluate(
      (submission) =>
        window.postMessage(
          {
            type: 'sent',
            id: submission.id ?? submission.draftKey,
            text: submission.text,
            submissionId: submission.submissionId,
          },
          '*',
        ),
      submission,
    );
    await page
      .getByRole('button', { name: 'Stop agent', exact: true })
      .waitFor({ state: 'detached' });
  };
  await box.fill('Submitted content');
  await attach('00000000-0000-4000-8000-000000000001.png');
  await page.locator('.composer .attachment-image').waitFor();
  await box.press('Enter');
  const old = (await sentOf('send')).at(-1);
  assert.ok(old.submissionId);
  await box.fill('Newer content [Image #1]');
  await attach('00000000-0000-4000-8000-000000000010.png');
  await page.waitForFunction(
    () => document.querySelectorAll('.composer .attachment-image').length === 2,
  );
  // An auxiliary failure and an unrelated snapshot must leave the send guard in place.
  await page.evaluate(() =>
    window.postMessage({ type: 'error', text: 'Auxiliary action failed' }, '*'),
  );
  await update('claude-two');
  const count = (await sentOf('send')).length;
  await box.press('Enter');
  assert.equal((await sentOf('send')).length, count);
  await acknowledge(old);
  await page.waitForFunction(
    () => document.querySelectorAll('.composer .attachment-image').length === 1,
  );
  assert.match((await box.getAttribute('data-value')) ?? '', /Newer content/);
  assert.equal(await page.locator('.composer .attachment-image').count(), 1);
  // Re-typing exactly the submitted text is a newer revision too.
  await box.fill('Repeated text');
  await box.press('Enter');
  const repeated = (await sentOf('send')).at(-1);
  await box.fill('Temporary edit');
  await box.fill('Repeated text');
  await acknowledge(repeated);
  await page.waitForFunction(
    () => document.querySelectorAll('.composer .attachment-image').length === 0,
  );
  assert.equal(await box.getAttribute('data-value'), 'Repeated text');
  await box.press('Enter');
  const latest = (await sentOf('send')).at(-1);
  // An old failure cannot release a later send, even on the same thread.
  await page.evaluate(
    (submission) =>
      window.postMessage(
        {
          type: 'error',
          text: 'Late failure',
          operation: {
            kind: 'submission',
            submissionId: submission.submissionId,
            draftKey: submission.id,
          },
        },
        '*',
      ),
    repeated,
  );
  await page.evaluate(
    () =>
      new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.getByText('Late failure', { exact: true }).count(), 0);
  await box.press('Enter');
  assert.equal((await sentOf('send')).at(-1).submissionId, latest.submissionId);
  await page.evaluate(
    (submission) =>
      window.postMessage(
        {
          type: 'error',
          text: 'Send refused',
          operation: {
            kind: 'submission',
            submissionId: submission.submissionId,
            draftKey: submission.id,
          },
        },
        '*',
      ),
    latest,
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  assert.equal(await box.getAttribute('data-value'), 'Repeated text');
  await box.press('Enter');
  const retry = (await sentOf('send')).at(-1);
  assert.notEqual(retry.submissionId, latest.submissionId);
  await acknowledge(retry);
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('.composer-input')?.dataset.value === '',
  );

  // Delegation may run beside a provider turn, but repeat Enter cannot duplicate a pending send.
  await box.fill('@codex Check this');
  await box.press('Enter');
  const delegated = (await sentOf('delegate')).at(-1);
  assert.ok(delegated?.submissionId);
  const delegates = (await sentOf('delegate')).length;
  await box.press('Enter');
  assert.equal((await sentOf('delegate')).length, delegates);
  await acknowledge(delegated);
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('.composer-input')?.dataset.value === '',
  );
  // Reject oversized payloads before acquiring a submission guard, so correction can be retried.
  const beforeOversized = (await sentOf('send')).length;
  await box.fill('x'.repeat(200001));
  await box.press('Enter');
  assert.equal((await sentOf('send')).length, beforeOversized);
  await box.fill('Corrected message');
  await box.press('Enter');
  const corrected = (await sentOf('send')).at(-1);
  assert.equal(corrected.text, 'Corrected message');
  // An acknowledgement in the first thread must not erase a message edit in another thread.
  const editTemplate = ctx.snapshot.sessions.find((session) => session.id === 'claude-two');
  assert.ok(editTemplate);
  ctx.snapshot.sessions.push({
    ...editTemplate,
    id: 'edit-ack-fixture',
    title: 'Edit acknowledgement fixture',
    messages: [{ id: 'edit-user', role: 'user', text: 'Original message', nativeTurn: 'turn-1' }],
  } as unknown as (typeof ctx.snapshot.sessions)[number]);
  await update('edit-ack-fixture');
  const mine = page.locator('article.user-message', { hasText: 'Original message' });
  await mine.hover();
  await mine.getByRole('button', { name: 'Edit and resend from here' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(),
    true,
  );
  await acknowledge(corrected);
  await page.getByText('Files it changed are not reverted.').waitFor();
  await box.fill('Edited message');
  await box.press('Enter');
  const edit = (await sentOf('rewind')).at(-1);
  assert.equal(edit.messageId, 'edit-user');
  await acknowledge(edit);
  await page.getByText('Files it changed are not reverted.').waitFor({ state: 'detached' });
  ctx.snapshot.sessions.pop();
  await update('claude-two');
  await box.fill('');
  // The first acknowledgement transfers newer content from a draft tab to its real thread.
  await update(undefined);
  await box.fill('First message');
  await box.press('Enter');
  const start = (await sentOf('start')).at(-1);
  await box.fill('Follow-up waiting for thread creation');
  await page.evaluate(
    (key) =>
      window.postMessage(
        {
          type: 'attached',
          draftKey: key,
          attachment: {
            kind: 'image',
            file: '00000000-0000-4000-8000-000000000001.png',
            name: 'carried.png',
          },
        },
        '*',
      ),
    start.draftKey,
  );
  await page.locator('.composer .attachment-image').waitFor();
  await page.evaluate(
    (submission) =>
      window.postMessage(
        {
          type: 'sent',
          id: submission.draftKey,
          text: submission.text,
          submissionId: submission.submissionId,
          threadId: 'draft-ack-fixture',
        },
        '*',
      ),
    start,
  );
  const template = ctx.snapshot.sessions.find((session) => session.id === 'claude-two');
  assert.ok(template);
  ctx.snapshot.sessions.push({
    ...template,
    id: 'draft-ack-fixture',
    title: 'Acknowledgement fixture',
    messages: [],
  });
  await update('draft-ack-fixture');
  assert.match(
    (await box.getAttribute('data-value')) ?? '',
    /Follow-up waiting for thread creation/,
  );
  assert.equal(await page.locator('.composer .attachment-image').count(), 1);
  ctx.snapshot.sessions.pop();
  await update('claude-two');
}
