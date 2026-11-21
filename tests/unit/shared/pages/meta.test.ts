import assert from 'node:assert/strict';
import test from 'node:test';
import { splitFrontMatter, withPageMeta } from '../../../../src/shared/domain/pages/meta';

test('front matter is read into the page’s meta and split from its body', () => {
  const page = '---\nicon: "📅"\npinned: true\nby: agent\ntags: work\n---\n\n# Today\n';
  const { front, body, meta } = splitFrontMatter(page);
  assert.deepEqual(meta, { icon: '📅', pinned: true, by: 'agent' });
  assert.equal(body, '# Today\n');
  assert.equal(front + body, page);
});

test('a page without front matter is all body', () => {
  assert.deepEqual(splitFrontMatter('# Hi\n'), { front: '', body: '# Hi\n', meta: {} });
  assert.deepEqual(splitFrontMatter('---\nnot closed\n# Hi').meta, {});
});

test('changing meta keeps keys you wrote and drops an empty block', () => {
  const page = '---\nicon: 📝\ntags: work\n---\n\n# Plan\n';
  assert.equal(
    withPageMeta(page, { icon: '🚀', pinned: true }),
    '---\nicon: 🚀\npinned: true\ntags: work\n---\n\n# Plan\n',
  );
  assert.equal(withPageMeta('---\nicon: 📝\n---\n\n# Plan\n', { icon: undefined }), '# Plan\n');
  assert.equal(withPageMeta('# Plan\n', { pinned: false }), '# Plan\n');
});
