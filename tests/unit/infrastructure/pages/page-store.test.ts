import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PageNotFound, PageStore } from '../../../../src/infrastructure/pages/page-store';

async function withStore(run: (store: PageStore, folder: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(tmpdir(), 'pages-'));
  let n = 0;
  try {
    await run(new PageStore(folder, () => `00000${n++}`), folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('a new page is named after its title and listed', () =>
  withStore(async (store) => {
    const id = await store.create('Release plan');
    assert.equal(id, 'release-plan-000000');
    assert.equal(await store.read(id), '# Release plan\n\n');
    const byAgent = await store.create('Notes', 'Body', { by: 'agent' });
    assert.equal(await store.read(byAgent), '---\nby: agent\n---\n\n# Notes\n\nBody\n');
    assert.deepEqual((await store.list()).map((entry) => entry.title).sort(), [
      'Notes',
      'Release plan',
    ]);
  }));

test('ids outside the store are refused', () =>
  withStore(async (store) => {
    assert.throws(() => store.file('../escape'), PageNotFound);
    await assert.rejects(store.read('missing-page'), PageNotFound);
    assert.equal(store.idOf(path.join(store.folder, 'daily', '2026-11-21.md')), 'daily/2026-11-21');
    assert.equal(store.idOf(path.join(store.folder, 'assets', 'x.png')), undefined);
  }));

test('a daily page is created once from its template', () =>
  withStore(async (store) => {
    const id = await store.daily('2026-11-21');
    await store.write(id, '# Kept\n');
    assert.equal(await store.daily('2026-11-21'), id);
    assert.equal(await store.read(id), '# Kept\n');
    await store.daily('2026-11-19');
    assert.equal(await store.previousDaily('2026-11-21'), 'daily/2026-11-19');
    assert.equal(await store.previousDaily('2026-11-19'), undefined);
  }));

test('a duplicate keeps the text under a new title', () =>
  withStore(async (store) => {
    const id = await store.create('Plan');
    await store.write(id, '---\nicon: 🚀\n---\n\n# Plan\n\nText\n');
    const copy = await store.duplicate(id);
    assert.equal(await store.read(copy), '---\nicon: 🚀\n---\n\n# Plan (copy)\n\nText\n');
  }));

test('trash and restore round-trip, and a taken id gets a new one', () =>
  withStore(async (store) => {
    const id = await store.create('Plan');
    await store.trash(id);
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(
      (await store.trashed()).map((entry) => entry.id),
      [id],
    );
    assert.equal(await store.restore(id), id);
    await store.trash(id);
    await store.write(id, '# Newer\n');
    const restored = await store.restore(id);
    assert.notEqual(restored, id);
    assert.equal(await store.read(restored), '# Plan\n\n');
    await store.trash(restored);
    await store.deleteForever(restored);
    assert.deepEqual(await store.trashed(), []);
  }));

test('search needs every word and ranks title hits first', () =>
  withStore(async (store) => {
    const body = await store.create('Groceries', '- [ ] buy release candy');
    const title = await store.create('Release plan', 'ship it');
    assert.deepEqual(
      (await store.search('release')).map((result) => result.entry.id),
      [title, body],
    );
    assert.equal((await store.search('release')).at(-1)?.excerpt, 'buy release candy');
    assert.deepEqual(await store.search('release missing'), []);
    assert.deepEqual(await store.search('  '), []);
  }));

test('the old todo list becomes today’s page once, and is renamed not deleted', () =>
  withStore(async (store, folder) => {
    const legacy = path.join(folder, 'todos.md');
    await writeFile(legacy, '<!-- x -->\n## Done\n- [x] old\n');
    const id = await store.migrateTodos(legacy, '2026-11-21');
    assert.equal(id, 'daily/2026-11-21');
    assert.match(
      await store.read(id),
      /## From your todo list\n\n### Done earlier\n- \[x\] old\n$/,
    );
    assert.equal(await readFile(`${legacy}.migrated`, 'utf8'), '<!-- x -->\n## Done\n- [x] old\n');
    assert.equal(await store.migrateTodos(legacy, '2026-11-21'), undefined);
  }));
