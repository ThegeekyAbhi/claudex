import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_COLUMN,
  withColumnWidth,
} from '../../../../src/webview/features/pages/editor/plugins/column-widths';

test('a dragged column keeps its width, and other tables and columns are untouched', () => {
  const first = withColumnWidth([], 1, 2, 240.4, 3);
  assert.deepEqual(first, [null, [0, 0, 240]]);
  const second = withColumnWidth(first, 0, 0, 10, 2);
  assert.deepEqual(second, [
    [MIN_COLUMN, 0],
    [0, 0, 240],
  ]);
});

test('a table whose column count changed starts again, and automatic widths are dropped', () => {
  const stale = withColumnWidth([[100, 200]], 0, 0, 150, 3);
  assert.deepEqual(stale, [[150, 0, 0]]);
  assert.deepEqual(withColumnWidth([[150, 0, 0]], 0, 0, 0, 3), []);
});
