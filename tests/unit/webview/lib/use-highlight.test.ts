import assert from 'node:assert/strict';
import test from 'node:test';
import { languageOfPath, loadEngine, tokenize } from '../../../../src/webview/lib/use-highlight';

test('a file name picks its language', () => {
  assert.equal(languageOfPath('src/providers/history/claude-tail.ts'), 'typescript');
  assert.equal(languageOfPath('C:\\work\\app\\main.rs'), 'rust');
  assert.equal(languageOfPath('web/App.TSX'), 'tsx');
  assert.equal(languageOfPath('lib/util.mjs'), 'javascript');
  assert.equal(languageOfPath('Dockerfile'), 'dockerfile');
  assert.equal(languageOfPath('ops/api.Dockerfile'), 'dockerfile');
  assert.equal(languageOfPath('include/list.hpp'), 'cpp');
  assert.equal(languageOfPath('Makefile'), undefined);
  assert.equal(languageOfPath('.gitignore'), undefined);
});

test('code is coloured with both Light+ and Dark+, and plain text stays plain', async () => {
  assert.ok(await loadEngine());
  const lines = tokenize("import { open } from 'node:fs';\n// done", 'ts');
  assert.ok(lines);
  assert.equal(lines.length, 2);
  const keyword = lines[0].find((token) => token.content === 'import');
  assert.deepEqual(keyword, { content: 'import', light: '#af00db', dark: '#c586c0' });
  const text = lines[0].map((token) => token.content).join('');
  assert.equal(text, "import { open } from 'node:fs';");
  const string = lines[0].find((token) => token.content.includes('node:fs'));
  assert.ok(string?.dark && string.dark !== keyword?.dark, 'strings and keywords differ');
  const brace = lines[0].find((token) => token.content.trim() === '{');
  assert.equal(brace?.dark, undefined, 'punctuation keeps the text colour');
});

test('an unknown language is left plain', async () => {
  await loadEngine();
  assert.equal(tokenize('anything', 'klingon'), null);
  assert.equal(tokenize('anything', undefined), null);
});
