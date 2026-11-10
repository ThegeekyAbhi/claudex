import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReferenceIcon } from '../../../../src/webview/components/reference-icon';

function markup(kind: 'file' | 'folder', path: string) {
  return renderToStaticMarkup(createElement(ReferenceIcon, { kind, path }));
}
test('folders use a full-sized outline icon and file names resolve to distinct SVG icons', () => {
  assert.match(markup('folder', 'scripts'), /lucide-folder/);
  const generic = markup('file', 'unknown.extension');
  for (const name of ['route.ts', 'plan.md', '.gitignore', 'package.json']) {
    const rendered = markup('file', name);
    assert.match(rendered, /<svg/);
    assert.match(rendered, /width="14"/);
    assert.notEqual(rendered, generic, `${name} has a specific icon`);
    assert.doesNotMatch(rendered, />GITI</);
  }
  assert.equal(markup('file', 'src/route.ts'), markup('file', 'route.ts'));
  assert.equal(markup('file', 'src\\route.ts'), markup('file', 'route.ts'));
});
