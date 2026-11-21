import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type BlockRanges,
  preserveMarkdown,
} from '../../../../src/webview/features/pages/editor/preserve';

/** Blocks separated by blank lines, as a Markdown parser would report simple paragraphs. */
const ranges: BlockRanges = (markdown) => {
  const out: { start: number; end: number }[] = [];
  const pattern = /[^\n]+(?:\n[^\n]+)*/g;
  for (let match = pattern.exec(markdown); match; match = pattern.exec(markdown))
    out.push({ start: match.index, end: match.index + match[0].length });
  return out;
};

const original = '# Plan\n\n* one\n* two\n\n\nSome \\_text\\_ here\n';
// The editor's own rendering: `-` bullets, a single blank line, no escapes.
const canonical = '# Plan\n\n- one\n- two\n\nSome _text_ here\n';

test('an unedited page is returned exactly as it was written', () => {
  assert.equal(preserveMarkdown(original, canonical, canonical, ranges), original);
});

test('only the edited block takes the editor’s form; the rest keep their text and spacing', () => {
  const next = '# Release plan\n\n- one\n- two\n\nSome _text_ here\n';
  assert.equal(
    preserveMarkdown(original, canonical, next, ranges),
    '# Release plan\n\n* one\n* two\n\n\nSome \\_text\\_ here\n',
  );
});

test('a new block between two old ones is separated plainly', () => {
  const next = '# Plan\n\n- one\n- two\n\nNew\n\nSome _text_ here\n';
  assert.equal(
    preserveMarkdown(original, canonical, next, ranges),
    '# Plan\n\n* one\n* two\n\nNew\n\nSome \\_text\\_ here\n',
  );
});

test('a removed block takes nothing else with it', () => {
  const next = '# Plan\n\nSome _text_ here\n';
  assert.equal(
    preserveMarkdown(original, canonical, next, ranges),
    '# Plan\n\nSome \\_text\\_ here\n',
  );
});

test('when the two renderings disagree on blocks, the editor’s text wins', () => {
  assert.equal(preserveMarkdown('a\n\nb\n', 'a b\n', 'a c\n', ranges), 'a c\n');
  assert.equal(preserveMarkdown('a\n', 'a\n', '', ranges), '');
});
