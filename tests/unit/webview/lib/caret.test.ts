import assert from 'node:assert/strict';
import test from 'node:test';
import { MENU_MAX_HEIGHT, placeMenu } from '../../../../src/webview/lib/caret';

const viewport = { width: 1000, height: 900 };
const frame = { left: 100, top: 100, bottom: 300 };

test('the menu opens under the caret when it fits', () => {
  const anchor = placeMenu({ left: 180, top: 120, bottom: 140 }, frame, viewport, 360);
  assert.equal(anchor.left, 80);
  assert.equal(anchor.top, 44);
  assert.equal(anchor.bottom, undefined);
  assert.equal(anchor.maxHeight, MENU_MAX_HEIGHT);
});

test('near the bottom of the window it opens above the line instead', () => {
  const low = { left: 100, top: 700, bottom: 900 };
  const anchor = placeMenu({ left: 180, top: 720, bottom: 740 }, low, viewport, 360);
  assert.equal(anchor.top, undefined);
  assert.equal(anchor.bottom, 184);
  assert.equal(anchor.maxHeight, MENU_MAX_HEIGHT);
});

test('it never runs off the right edge, and limits itself to the room it has', () => {
  const anchor = placeMenu({ left: 900, top: 120, bottom: 140 }, frame, viewport, 360);
  assert.equal(anchor.left, 532);
  assert.ok(anchor.previewWidth < 160, 'no room for the path preview');
  const short = placeMenu(
    { left: 180, top: 100, bottom: 120 },
    frame,
    { width: 1000, height: 300 },
    360,
  );
  assert.equal(short.maxHeight, 168);
});
