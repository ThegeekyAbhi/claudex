import assert from 'node:assert/strict';
import test from 'node:test';
import { VISUAL_POLICY, VISUAL_SANDBOX, visualDocument } from '../src/webview/lib/visual-document';

const theme = { tokens: { foreground: '#fff' }, font: 'Inter', colorScheme: 'dark' };

test('the sandbox never allows scripts', () => {
  assert.doesNotMatch(VISUAL_SANDBOX, /allow-scripts/);
  assert.doesNotMatch(VISUAL_SANDBOX, /allow-top-navigation|allow-popups|allow-forms/);
});

test('the policy blocks scripts and network, and precedes the agent markup', () => {
  assert.match(VISUAL_POLICY, /default-src 'none'/);
  assert.doesNotMatch(VISUAL_POLICY, /script-src|https?:|\*/);
  const page = visualDocument('<b id="agent">hello</b>', theme);
  const policy = page.indexOf('Content-Security-Policy');
  assert.ok(policy > 0 && policy < page.indexOf('<style>'));
  assert.ok(policy < page.indexOf('id="agent"'));
});

test('theme values cannot escape the style element', () => {
  const page = visualDocument('x', {
    tokens: { foreground: 'red;}</style><script>alert(1)</script>' },
    font: 'Inter',
    colorScheme: 'dark',
  });
  assert.doesNotMatch(page, /<script>/);
  assert.equal(page.match(/<\/style>/g)?.length, 1);
});
