import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPageEdit,
  editFits,
  SuggestionStale,
  textChange,
} from '../../../../src/shared/domain/pages/edits';

test('an edit replaces exactly one occurrence of its find', () => {
  assert.equal(applyPageEdit('a b c', { find: 'b', replace: 'B' }), 'a B c');
  assert.throws(() => applyPageEdit('b b', { find: 'b', replace: 'B' }), SuggestionStale);
  assert.throws(() => applyPageEdit('a', { find: 'z', replace: 'Z' }), SuggestionStale);
  assert.equal(editFits('b b', { find: 'b', replace: 'B' }), false);
  assert.equal(editFits('a b', { find: 'b', replace: 'B' }), true);
});

test('an empty find appends a section to the end', () => {
  assert.equal(
    applyPageEdit('# Page\n\n\n', { find: '', replace: ' ## New \n' }),
    '# Page\n\n## New\n',
  );
});

test('the smallest change between two texts', () => {
  assert.equal(textChange('same', 'same'), undefined);
  assert.deepEqual(textChange('hello world', 'hello there world'), {
    start: 6,
    end: 6,
    text: 'there ',
  });
  assert.deepEqual(textChange('abc', 'ac'), { start: 1, end: 2, text: '' });
});
