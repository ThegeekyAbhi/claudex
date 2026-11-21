import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { PAGE_ID } from '../../shared/domain/pages/entry';
import { atomicWrite } from './files';
import { PageNotFound } from './page-not-found';

export const ASSETS = 'assets';
const ASSET_LIMIT = 10 * 1024 * 1024;

/**
 * Images in your pages: one shared folder beside them, each file named by its content so the
 * same picture is stored once and a duplicated page needs no new copies.
 */
export class AssetStore {
  constructor(readonly folder: string) {}

  /** Saves an image for a page and returns its Markdown path, relative to that page. */
  async save(pageId: string, bytes: Uint8Array, extension: string): Promise<string> {
    if (!PAGE_ID.test(pageId)) throw new PageNotFound(pageId);
    if (!/^(png|jpg|gif|webp)$/.test(extension))
      throw new Error('That kind of image isn’t supported.');
    if (bytes.byteLength > ASSET_LIMIT) throw new Error('Images can be at most 10 MB.');
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`;
    const file = path.join(this.folder, name);
    try {
      await stat(file);
    } catch {
      await atomicWrite(file, bytes);
    }
    return `${pageId.includes('/') ? '../' : ''}${ASSETS}/${name}`;
  }
}
