import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type SavedViewSources,
  savedViewState,
} from '../../../../src/webview/app/saved-view-state';

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
