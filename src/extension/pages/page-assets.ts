import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AssetStore } from '../../infrastructure/pages/asset-store';
import { sniffImage } from '../../providers/shared/image-store';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const IMPORT_LIMIT = 10 * 1024 * 1024;

/** Saves an image you added to a page and returns its path, relative to that page. */
export async function saveImage(
  assets: AssetStore,
  id: string,
  mime: string,
  base64: string,
): Promise<string> {
  const extension = EXTENSIONS[mime];
  if (!extension) throw new Error('That kind of image isn’t supported.');
  return assets.save(id, Buffer.from(base64, 'base64'), extension);
}

/**
 * Copies an image file into a page's assets, for an agent or the page's chat. Only files under
 * one of `roots` are read, after resolving symbolic links, so a page can't be used to read
 * anything else on the machine. The file's bytes decide its type, not its name.
 */
export async function importImage(
  assets: AssetStore,
  id: string,
  source: string,
  roots: readonly string[],
): Promise<string> {
  if (!path.isAbsolute(source)) throw new Error('Give the image’s absolute path.');
  let real: string;
  try {
    real = await realpath(source);
  } catch {
    throw new Error(`There’s no image at ${source}.`);
  }
  const allowed = await Promise.all(roots.map((root) => realpath(root).catch(() => undefined)));
  if (!allowed.some((root) => root && within(root, real)))
    throw new Error(
      'Only images in the workspace, or ones an agent generated, can be added to a page.',
    );
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${source} isn’t a file.`);
  if (info.size > IMPORT_LIMIT) throw new Error('Images can be at most 10 MB.');
  const bytes = await readFile(real);
  const extension = sniffImage(bytes);
  if (!extension) throw new Error('Only PNG, JPEG, GIF and WebP images can be added.');
  return assets.save(id, bytes, extension);
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
