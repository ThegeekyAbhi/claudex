import assert from 'node:assert/strict';
import test from 'node:test';
import { type Attachment, attachmentToken } from '../../../../../src/shared/model';
import { referenceParts } from '../../../../../src/webview/features/composer/references';

const files: Attachment[] = [
  { kind: 'file', path: 'src/app/route.ts' },
  { kind: 'file', path: 'src/api/route.ts' },
  { kind: 'folder', path: 'scripts' },
];
test('path references preserve their full serialized text and disambiguate names', () => {
  const text = 'Fix [src/app/route.ts] and [src/api/route.ts] using [scripts].';
  const parts = referenceParts(text, files);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(
    parts.filter((part) => part.attachment).map((part) => part.label),
    ['app/route.ts', 'api/route.ts', 'scripts'],
  );
  assert.equal(attachmentToken(files[0]), '[src/app/route.ts]');
});
test('legacy basename references resolve only when unambiguous', () => {
  assert.equal(referenceParts('[route.ts]', files)[0].attachment, undefined);
  assert.equal(referenceParts('[route.ts]', [files[0]])[0].attachment, files[0]);
  assert.equal(referenceParts('[ordinary text]', files)[0].attachment, undefined);
});
test('repeated references retain metadata and numbered image files stay identifiable', () => {
  const image: Attachment = { kind: 'file', path: 'assets/shot.png', reference: 2 };
  const parts = referenceParts('[scripts] [scripts] [Image #2]', [...files, image]);
  assert.equal(parts.filter((part) => part.attachment === files[2]).length, 2);
  assert.equal(parts.at(-1)?.attachment, image);
});

test('image numbering preserves surviving references and assigns new images after them', async () => {
  const { numberImages } = await import('../../../../../src/shared/model');
  const images: Attachment[] = [
    { kind: 'image', file: 'sample.png', name: 'image.png', reference: 1 },
    { kind: 'file', path: 'shot.png', reference: 3 },
    { kind: 'image', file: 'sample-2.png', name: 'image.png' },
  ];
  const numbered = numberImages(images);
  assert.equal(attachmentToken(numbered[1]), '[Image #3]');
  assert.equal(attachmentToken(numbered[2]), '[Image #4]');
  assert.deepEqual(numberImages(numbered), numbered);
});
