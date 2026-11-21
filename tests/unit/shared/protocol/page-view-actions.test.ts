import assert from 'node:assert/strict';
import test from 'node:test';
import { pageViewActionSchema } from '../../../../src/shared/protocol/pages';

const ok = (action: unknown) => pageViewActionSchema.safeParse(action).success;

test('a page may ask for files to mention, within limits', () => {
  assert.ok(ok({ type: 'pageSearchFiles', requestId: 'r1', query: 'app' }));
  assert.equal(ok({ type: 'pageSearchFiles', requestId: 'r1', query: 'x'.repeat(201) }), false);
});

test('a page may send an image of a supported kind and size', () => {
  const image = { type: 'pageImage', requestId: 'r1', name: 'shot.png', mime: 'image/png' };
  assert.ok(ok({ ...image, data: 'iVBORw0KGgo=' }));
  assert.equal(ok({ ...image, mime: 'image/svg+xml', data: 'PHN2Zz4=' }), false);
  assert.equal(ok({ ...image, data: 'A'.repeat(14 * 1024 * 1024 + 4) }), false);
});

test('the page chat replies, stops, and picks threads with validated messages', () => {
  assert.ok(ok({ type: 'pageReply', threadId: 't1', prompt: 'Also add a table' }));
  assert.equal(ok({ type: 'pageReply', threadId: 't1', prompt: '   ' }), false);
  assert.ok(ok({ type: 'pageStop', threadId: 't1' }));
  assert.ok(ok({ type: 'pageThread' }));
  assert.ok(ok({ type: 'pageThread', threadId: 't1' }));
  assert.equal(ok({ type: 'pageApprove', threadId: 't1' }), false);
});

test('a page may ask which of its paths are files, within limits', () => {
  assert.ok(ok({ type: 'pageResolvePaths', requestId: 'r1', paths: ['src/app.ts'] }));
  assert.equal(
    ok({ type: 'pageResolvePaths', requestId: 'r1', paths: Array(201).fill('a.ts') }),
    false,
  );
  assert.equal(ok({ type: 'pageResolvePaths', requestId: 'r1', paths: ['x'.repeat(501)] }), false);
});

test('page width, table column widths and plan builds are validated', () => {
  assert.ok(ok({ type: 'pageAllPages' }));
  assert.ok(ok({ type: 'pageWidth', width: 'full' }));
  assert.equal(ok({ type: 'pageWidth', width: 'huge' }), false);

  assert.ok(ok({ type: 'pageTableWidths', widths: [[180, 0, 320], null] }));
  assert.equal(ok({ type: 'pageTableWidths', widths: [[-5]] }), false);
  assert.equal(ok({ type: 'pageTableWidths', widths: [[12.5]] }), false);
  assert.equal(ok({ type: 'pageTableWidths', widths: [new Array(31).fill(100)] }), false);
  assert.equal(ok({ type: 'pageTableWidths', widths: new Array(51).fill(null) }), false);

  assert.ok(ok({ type: 'pagePlanBuild', threadId: 't1', approvals: 'auto' }));
  assert.ok(ok({ type: 'pagePlanBuild', threadId: 't1', agent: 'codex', model: 'gpt-6.2' }));
  assert.equal(ok({ type: 'pagePlanBuild', threadId: 't1', approvals: 'yolo' }), false);
  assert.equal(ok({ type: 'pagePlanBuild' }), false);
});
