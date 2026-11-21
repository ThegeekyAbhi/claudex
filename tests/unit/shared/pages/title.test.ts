import assert from 'node:assert/strict';
import test from 'node:test';
import { pageFileName, pageSlug, pageTitle } from '../../../../src/shared/domain/pages/title';

test('a page’s tab is named after its title', () => {
  assert.equal(pageFileName('Release plan'), 'Release plan.md');
  assert.equal(pageFileName('Friday, 21 November'), 'Friday, 21 November.md');
});

test('characters a path can’t hold are dropped from the name', () => {
  assert.equal(pageFileName('a/b: c?  "d" #1'), 'a b c d 1.md');
  assert.equal(pageFileName('Notes...'), 'Notes.md');
  assert.equal(pageFileName('  '), 'Untitled.md');
  assert.equal(pageFileName('x'.repeat(200)).length, 83);
});

test('the title is the first top-level heading, as plain text', () => {
  assert.equal(pageTitle('Intro line\n\n# Release **plan** [v2](x.md)\n'), 'Release plan v2');
  assert.equal(pageTitle('## Not this\n# This one #\n'), 'This one');
});

test('headings inside code fences are not titles', () => {
  assert.equal(pageTitle('```md\n# Fake\n```\n# Real\n'), 'Real');
});

test('without a heading the first line of text names the page', () => {
  assert.equal(pageTitle('\n- [ ] Buy *milk*\n'), 'Buy milk');
  assert.equal(pageTitle('> Quoted idea\n'), 'Quoted idea');
  assert.equal(pageTitle('\n  \n'), 'Untitled');
});

test('slugs are short, lowercase and safe', () => {
  assert.equal(pageSlug('Release Plan: Q3 / 2026!'), 'release-plan-q3-2026');
  assert.equal(pageSlug('Café'), 'cafe');
  assert.equal(pageSlug('!!!'), 'page');
  assert.ok(pageSlug('a'.repeat(100)).length <= 48);
});
