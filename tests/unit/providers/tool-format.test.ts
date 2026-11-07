import assert from 'node:assert/strict';
import test from 'node:test';
import { displayCommand } from '../../../src/providers/tool-format';

test('shell wrappers are removed from displayed commands', () => {
  assert.equal(displayCommand(`/bin/zsh -lc 'command -v claude2'`), 'command -v claude2');
  assert.equal(displayCommand(`/bin/zsh -lc "zsh -ic 'claude2 -p hi'"`), `zsh -ic 'claude2 -p hi'`);
  assert.equal(displayCommand('pnpm test'), 'pnpm test');
});
