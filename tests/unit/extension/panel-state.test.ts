import assert from 'node:assert/strict';
import test from 'node:test';
import { restoredThreadId } from '../../../src/extension/panel-state';

const exists = (id: string) => id === 'thread-1';

test('a restored chat tab reopens the thread it was showing', () => {
  assert.equal(restoredThreadId({ selectedId: 'thread-1', drafts: {} }, exists), 'thread-1');
});

test('a restored chat tab opens empty when its thread is gone or the state is unusable', () => {
  assert.equal(restoredThreadId({ selectedId: 'deleted' }, exists), undefined);
  for (const state of [undefined, null, 'thread-1', 42, [], {}, { selectedId: 7 }])
    assert.equal(restoredThreadId(state, exists), undefined);
  assert.equal(
    restoredThreadId({ selectedId: '' }, () => true),
    undefined,
  );
  assert.equal(
    restoredThreadId({ selectedId: 'x'.repeat(201) }, () => true),
    undefined,
  );
});
