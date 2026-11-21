import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_IMAGE_HEIGHT,
  defaultFraction,
  MIN_IMAGE_WIDTH,
  widthFraction,
} from '../../../../src/webview/features/pages/editor/plugins/image-view';

test('a dragged width is kept as a share of the page column', () => {
  assert.equal(widthFraction(400, 800, 2000), 0.5);
  assert.equal(widthFraction(10, 800, 2000), MIN_IMAGE_WIDTH / 800);
});

test('full width is the image’s own size, unless that would shrink a small image back', () => {
  assert.equal(widthFraction(800, 800, 2000), 1);
  assert.equal(widthFraction(800, 800, 300), 0.99);
});

test('a Retina screenshot starts no taller than the default height', () => {
  // 2306×1582 from a 2× screen, in a 1000px page: 1153px on screen, capped to 360px tall.
  const ratio = defaultFraction({ width: 2306, height: 1582 }, 1000, 2);
  const width = ratio * 1000;
  assert.ok(Math.abs((width * 1582) / 2306 - DEFAULT_IMAGE_HEIGHT) < 8, `${width}px wide`);
});

test('an image that already fits keeps its own size', () => {
  assert.equal(defaultFraction({ width: 300, height: 200 }, 1000, 1), 1);
  assert.equal(defaultFraction({ width: 2400, height: 300 }, 1000, 1), 1);
  assert.equal(defaultFraction({ width: 0, height: 0 }, 1000, 2), 1);
});

test('a small image from a 2× screen starts at its on-screen size', () => {
  assert.equal(defaultFraction({ width: 600, height: 400 }, 1000, 2), 0.3);
});
