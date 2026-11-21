import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignUnits,
  placeEdit,
  wordDiff,
} from '../../../../src/webview/features/pages/editor/review-diff';

const join = (ops: { kind: string; text: string }[], keep: string) =>
  ops
    .filter((op) => op.kind === 'same' || op.kind === keep)
    .map((op) => op.text)
    .join('');

test('a word diff rebuilds both texts and shows removals before additions', () => {
  const before = 'The plan is good and short.';
  const after = 'The plan is careful, measured and short.';
  const ops = wordDiff(before, after);
  assert.equal(join(ops, 'del'), before);
  assert.equal(join(ops, 'ins'), after);
  const changed = ops.filter((op) => op.kind !== 'same').map((op) => op.kind);
  assert.deepEqual(changed, ['del', 'ins']);
});

test('an edit is placed on the blocks it touches', () => {
  const body = '# Title\n\nFirst para.\n\n- [ ] one\n- [ ] two\n';
  const blocks = [
    { start: 0, end: 7 },
    { start: 9, end: 20 },
    { start: 22, end: 41 },
  ];
  assert.deepEqual(placeEdit(body, blocks, { find: '- [ ] two', replace: '- [x] two' }), {
    kind: 'blocks',
    first: 2,
    last: 2,
    before: '- [ ] one\n- [ ] two',
    after: '- [ ] one\n- [x] two',
  });
  assert.deepEqual(placeEdit(body, blocks, { find: '', replace: '## More\n' }), {
    kind: 'append',
    after: '## More',
  });
  // An edit that no longer fits, or fits twice, isn't placed.
  assert.equal(placeEdit(body, blocks, { find: 'missing', replace: 'x' }), undefined);
  assert.equal(placeEdit(body, blocks, { find: '- [ ] ', replace: 'x' }), undefined);
});

test('list items line up, so only the changed ones are marked', () => {
  assert.deepEqual(alignUnits(['a', 'b', 'c'], ['a', 'B', 'c', 'd']), [
    { kind: 'same', a: 0, b: 0 },
    { kind: 'del', a: 1 },
    { kind: 'ins', b: 1 },
    { kind: 'same', a: 2, b: 2 },
    { kind: 'ins', b: 3 },
  ]);
});
