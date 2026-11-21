import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importImage } from '../../../../src/extension/pages/page-assets';
import { AssetStore } from '../../../../src/infrastructure/pages/asset-store';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function withFolders(
  run: (dirs: { workspace: string; outside: string; assets: AssetStore }) => Promise<void>,
) {
  const base = await mkdtemp(path.join(tmpdir(), 'page-assets-'));
  const workspace = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  try {
    await run({ workspace, outside, assets: new AssetStore(path.join(base, 'pages', 'assets')) });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test('an image in an allowed folder is copied into the page’s assets', () =>
  withFolders(async ({ workspace, assets }) => {
    const file = path.join(workspace, 'pizza.png');
    await writeFile(file, PNG);
    const src = await importImage(assets, 'plan-000000', file, [workspace]);
    assert.match(src, /^assets\/[0-9a-f]{16}\.png$/);
    assert.deepEqual(new Uint8Array(await readFile(path.join(assets.folder, '..', src))), PNG);
    // Daily pages link one folder up.
    assert.match(
      await importImage(assets, 'daily/2026-11-21', file, [workspace]),
      /^\.\.\/assets\//,
    );
  }));

test('files outside the allowed folders are refused, even through a symbolic link', () =>
  withFolders(async ({ workspace, outside, assets }) => {
    const secret = path.join(outside, 'secret.png');
    await writeFile(secret, PNG);
    await assert.rejects(importImage(assets, 'plan-000000', secret, [workspace]), /Only images/);
    const link = path.join(workspace, 'link.png');
    await symlink(secret, link);
    await assert.rejects(importImage(assets, 'plan-000000', link, [workspace]), /Only images/);
    await assert.rejects(importImage(assets, 'plan-000000', workspace, [workspace]), /Only images/);
  }));

test('only real images are copied, whatever their name', () =>
  withFolders(async ({ workspace, assets }) => {
    const fake = path.join(workspace, 'notes.png');
    await writeFile(fake, 'not an image');
    await assert.rejects(importImage(assets, 'plan-000000', fake, [workspace]), /Only PNG/);
    await assert.rejects(
      importImage(assets, 'plan-000000', 'relative.png', [workspace]),
      /absolute path/,
    );
    await assert.rejects(
      importImage(assets, 'plan-000000', path.join(workspace, 'missing.png'), [workspace]),
      /no image/,
    );
  }));
