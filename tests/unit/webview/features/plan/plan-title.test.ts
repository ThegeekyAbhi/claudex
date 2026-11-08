import assert from 'node:assert/strict';
import test from 'node:test';
import { planTitle } from '../../../../../src/webview/features/plan/plan-title';

test('a plan is named by its first heading that says what it is about', () => {
  assert.equal(planTitle('# Render cache\n\nDo it.'), 'Render cache');
  assert.equal(planTitle('# Plan: Add a **Say hi** button\n'), 'Add a Say hi button');
  assert.equal(planTitle('# Implementation plan — Faster tabs'), 'Faster tabs');
  // Section names don't stand in for a title.
  assert.equal(
    planTitle('# Plan\n\n## Context\n\n## Keep the build after a limit'),
    'Keep the build after a limit',
  );
  assert.equal(planTitle('## Context\n\nSome prose that is not a heading.'), '');
  assert.equal(planTitle('Just prose, no headings.'), '');
  // A heading inside text, or a hashtag, isn't one.
  assert.equal(planTitle('#hashtag\n    # indented code'), '');
});
