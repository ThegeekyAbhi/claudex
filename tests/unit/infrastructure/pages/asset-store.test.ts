import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PageStore } from '../../../../src/infrastructure/pages/page-store';

async function withStore(run: (store: PageStore, folder: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(tmpdir(), 'pages-'));
  try {
    await run(new PageStore(folder), folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('an image is saved beside your pages and named by its content', () =>
  withStore(async (store, folder) => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const src = await store.assets.save('release-plan-3f9a1c', bytes, 'png');
    assert.match(src, /^assets\/[0-9a-f]{16}\.png$/);
    assert.deepEqual(new Uint8Array(await readFile(path.join(folder, src))), bytes);
    // The same picture is stored once.
    assert.equal(await store.assets.save('other-page-000000', bytes, 'png'), src);
    assert.equal((await readdir(path.join(folder, 'assets'))).length, 1);
    // Images are not pages.
    assert.deepEqual(await store.list(), []);
  }));

test('a daily page links its images relative to its own folder', () =>
  withStore(async (store) => {
    const src = await store.assets.save('daily/2026-11-21', new Uint8Array([1]), 'webp');
    assert.match(src, /^\.\.\/assets\/[0-9a-f]{16}\.webp$/);
  }));

test('only images within the size limit are saved', () =>
  withStore(async (store) => {
    await assert.rejects(
      store.assets.save('notes-000000', new Uint8Array([1]), 'svg'),
      /isn’t supported/,
    );
    await assert.rejects(
      store.assets.save('notes-000000', new Uint8Array(10 * 1024 * 1024 + 1), 'png'),
      /at most 10 MB/,
    );
    await assert.rejects(store.assets.save('../escape', new Uint8Array([1]), 'png'));
  }));
