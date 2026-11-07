import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type SavedViewSources,
  savedViewState,
} from '../../../../src/webview/app/saved-view-state';
import { cleanSavedLayouts } from '../../../../src/webview/app/use-workspace-layout';

function savedSources(): SavedViewSources {
  return {
    tabs: { selectedId: 'local-id', tabs: ['draft:1', 'local-id'], activeDraft: 'draft:1' },
    drafts: {
      texts: { 'draft:1': 'Unsent' },
      attachments: { 'draft:1': [{ kind: 'file', path: 'src/app.ts' }] },
    },
    compose: {
      choice: { agent: 'codex', modes: { codex: 'plan' }, worktree: true },
      dismissedNudges: ['nudge'],
    },
    threads: { scroll: { current: { 'local-id': 80 } }, threadView: {}, seen: { 'local-id': 123 } },
  };
}

test('saved view projection keeps the exact existing serialized field names and order', () => {
  const sources = savedSources();
  assert.equal(
    JSON.stringify(savedViewState(sources)),
    '{"selectedId":"local-id","drafts":{"draft:1":"Unsent"},"attachments":{"draft:1":[{"kind":"file","path":"src/app.ts"}]},"scroll":{"local-id":80},"compose":{"agent":"codex","modes":{"codex":"plan"},"worktree":true},"dismissedNudges":["nudge"],"threadView":{},"tabs":["draft:1","local-id"],"activeDraft":"draft:1","seen":{"local-id":123}}',
  );
});

test('saved view retains optional selectedId and excludes transient hook fields', () => {
  const sources = savedSources();
  sources.tabs.selectedId = undefined;
  const state = savedViewState({
    ...sources,
    tabs: { ...sources.tabs, historyOpen: true },
  } as SavedViewSources);
  assert.deepEqual(Object.keys(state), [
    'selectedId',
    'drafts',
    'attachments',
    'scroll',
    'compose',
    'dismissedNudges',
    'threadView',
    'tabs',
    'activeDraft',
    'seen',
  ]);
  assert.equal(state.selectedId, undefined);
  assert.equal('historyOpen' in state, false);
  assert.equal('selectedId' in JSON.parse(JSON.stringify(state)), false);
});

test('saved view keeps reference identity including mutable scroll for pagehide persistence', () => {
  const sources = savedSources();
  const state = savedViewState(sources);
  assert.equal(state.drafts, sources.drafts.texts);
  assert.equal(state.attachments, sources.drafts.attachments);
  assert.equal(state.compose, sources.compose.choice);
  assert.equal(state.tabs, sources.tabs.tabs);
  assert.equal(state.seen, sources.threads.seen);
  sources.threads.scroll.current['local-id'] = 140;
  assert.deepEqual(state.scroll, { 'local-id': 140 });
});

test('pane sizes are saved only once there are some, after the existing fields', () => {
  const sources = savedSources();
  assert.equal('layouts' in savedViewState({ ...sources, layout: { layouts: {} } }), false);
  const state = savedViewState({
    ...sources,
    layout: { layouts: { 'workspace:main,threads': '{}' } },
  });
  assert.deepEqual(state.layouts, { 'workspace:main,threads': '{}' });
  assert.equal(Object.keys(state).at(-1), 'layouts');
});

test('restored pane sizes keep only plain strings, and only a bounded number of them', () => {
  assert.deepEqual(cleanSavedLayouts(undefined), {});
  assert.deepEqual(cleanSavedLayouts('nope'), {});
  assert.deepEqual(cleanSavedLayouts(['a']), {});
  assert.deepEqual(cleanSavedLayouts({ ok: '{"main":70}', bad: 3, worse: { x: 1 } }), {
    ok: '{"main":70}',
  });
  assert.deepEqual(cleanSavedLayouts({ huge: 'x'.repeat(5000) }), {});
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, '{}']));
  const kept = Object.keys(cleanSavedLayouts(many));
  assert.equal(kept.length, 16);
  assert.equal(kept.at(-1), 'k39', 'the most recent layouts are the ones kept');
});
