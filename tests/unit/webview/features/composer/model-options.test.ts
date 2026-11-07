import assert from 'node:assert/strict';
import test from 'node:test';
import type { Catalog, ModelOption } from '../../../../../src/shared/model';
import {
  effortsFor,
  keepEffort,
  modelOption,
} from '../../../../../src/webview/features/composer/model-options';

const defaultModel: ModelOption = {
  id: 'default',
  resolvedModel: 'resolved-default',
  label: 'Default',
  description: '',
  efforts: ['low', 'high'],
  isDefault: true,
};
const otherModel: ModelOption = {
  id: 'other',
  label: 'Other',
  description: '',
  efforts: ['medium'],
};
const catalog: Catalog = { codex: { status: 'ready', models: [otherModel, defaultModel] } };

test('composer resolves the catalog default, explicit IDs, and resolved model IDs', () => {
  assert.equal(modelOption(catalog, 'codex'), defaultModel);
  assert.equal(modelOption(catalog, 'codex', 'other'), otherModel);
  assert.equal(modelOption(catalog, 'codex', 'resolved-default'), defaultModel);
  assert.equal(modelOption(catalog, 'codex', 'missing'), undefined);
  assert.equal(modelOption(catalog, 'claude'), undefined);
  assert.equal(modelOption({}, 'codex'), undefined);
  assert.equal(
    modelOption({ codex: { status: 'ready', models: [otherModel] } }, 'codex'),
    undefined,
  );
});

test('composer keeps effort only when the selected model advertises it', () => {
  assert.deepEqual(effortsFor(catalog, 'codex'), ['low', 'high']);
  assert.deepEqual(effortsFor(catalog, 'codex', 'other'), ['medium']);
  assert.deepEqual(effortsFor(catalog, 'claude'), []);
  assert.equal(keepEffort(catalog, 'codex', undefined, 'high'), 'high');
  assert.equal(keepEffort(catalog, 'codex', 'other', 'high'), undefined);
  assert.equal(keepEffort(catalog, 'codex', 'other', 'medium'), 'medium');
  assert.equal(keepEffort(catalog, 'codex', 'other', undefined), undefined);
  assert.equal(keepEffort(catalog, 'codex', 'missing', 'high'), undefined);
});
