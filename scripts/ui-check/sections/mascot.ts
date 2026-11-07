import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';
import type { Session } from '../types';

export async function checkMascot(ctx: UiCheckContext): Promise<void> {
  // Uses claude-two after attachments has cleared its image chips.
  const { page, snapshot, update } = ctx;
  // Mascot state follows current activity; reduced motion freezes the same first frame.
  const mascotSession = snapshot.sessions.find((item) => item.id === 'claude-two') as Session;
  const beforeMascot = { ...mascotSession };
  Object.assign(mascotSession, {
    status: 'running',
    mode: 'auto',
    messages: [],
    approval: undefined,
    plan: undefined,
    transition: undefined,
  });
  for (const activity of ['working', 'thinking', 'planning', 'coding', 'reading'] as const) {
    mascotSession.mode = activity === 'planning' ? 'plan' : 'auto';
    mascotSession.messages =
      activity === 'thinking'
        ? [{ id: 'mascot-thought', role: 'thinking', text: 'Reviewing the task' }]
        : activity === 'coding' || activity === 'reading'
          ? [
              {
                id: 'mascot-tool',
                role: 'tool',
                text: '',
                tool: {
                  kind: activity === 'coding' ? 'edit' : 'read',
                  name: activity,
                  title: 'src/app.ts',
                  status: 'running',
                },
              },
            ]
          : [];
    await update(mascotSession.id);
    const mascot = page.locator(`.main .mascot[data-activity="${activity}"]`);
    await mascot.waitFor();
    assert.equal(
      await mascot.evaluate((element) => getComputedStyle(element, '::before').animationName),
      'none',
    );
    await mascot.evaluate(async (element) => {
      const background = getComputedStyle(element, '::before').backgroundImage;
      const image = new Image();
      image.src = background.slice(5, -2);
      await image.decode();
      if (image.naturalWidth !== 1024 || image.naturalHeight !== 128)
        throw new Error(`Unexpected mascot strip: ${image.naturalWidth}×${image.naturalHeight}`);
    });
    const gif = await page.evaluate(async (state) => {
      const response = await fetch(`/mascot/${state}.gif`);
      const decoder = new (window as any).ImageDecoder({
        data: await response.arrayBuffer(),
        type: 'image/gif',
      });
      await decoder.tracks.ready;
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Cannot inspect GIF frames');
      const pixels: Uint8ClampedArray[] = [];
      for (const frameIndex of [0, 4]) {
        const { image } = await decoder.decode({ frameIndex });
        context.clearRect(0, 0, 128, 128);
        context.drawImage(image, 0, 0);
        pixels.push(context.getImageData(0, 0, 128, 128).data);
        image.close();
      }
      const frameCount = decoder.tracks.selectedTrack.frameCount;
      decoder.close();
      return { frameCount, changed: pixels[0].some((value, index) => value !== pixels[1][index]) };
    }, activity);
    assert.equal(gif.frameCount, 8, `${activity} GIF contains eight animation frames`);
    assert.ok(gif.changed, `${activity} GIF has visibly different frames`);
    await page.screenshot({ path: `test-results/screenshots/mascot-${activity}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(
    await page
      .locator('.main .mascot')
      .evaluate((element) => getComputedStyle(element, '::before').animationName),
    'mascot-frames',
  );
  mascotSession.status = 'waiting';
  await update(mascotSession.id);
  const attentive = page.locator('.main .mascot[data-activity="attentive"]');
  await attentive.waitFor();
  assert.equal(
    await attentive.evaluate((element) => getComputedStyle(element, '::before').animationName),
    'none',
  );
  for (const status of ['completed', 'failed', 'interrupted'] as const) {
    mascotSession.status = status;
    await update(mascotSession.id);
    await page.locator('.main .mascot').waitFor({ state: 'detached' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  Object.assign(mascotSession, beforeMascot);
}
