import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_FILE, type ImageInput } from '../../core/model';

/** What this extension accepts from you. Generated images may be larger. */
export const MAX_ATTACHED_IMAGE = 10 * 1024 * 1024;
const MAX_STORED_IMAGE = 40 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
/** Reads the file's real type, so a renamed file cannot pass as an image. */
export function sniffImage(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return undefined;
}
/** Images live in one folder of their own, the only user data the webview can load. */
export class ImageStore {
  constructor(readonly folder: string) {}
  async save(bytes: Uint8Array, limit = MAX_STORED_IMAGE): Promise<string> {
    if (bytes.length > limit)
      throw new Error(`Images can be at most ${Math.round(limit / 1024 / 1024)} MB.`);
    const type = sniffImage(bytes);
    if (!type) throw new Error('Only PNG, JPEG, GIF, and WebP images can be used.');
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const file = `${randomUUID()}.${type}`;
    await writeFile(path.join(this.folder, file), bytes, { mode: 0o600 });
    return file;
  }
  async copy(source: string, limit = MAX_STORED_IMAGE): Promise<string> {
    const info = await stat(source);
    if (info.size > limit)
      throw new Error(`Images can be at most ${Math.round(limit / 1024 / 1024)} MB.`);
    return this.save(await readFile(source), limit);
  }
  path(file: string): string {
    if (!IMAGE_FILE.test(file)) throw new Error('Unknown image.');
    return path.join(this.folder, file);
  }
  input(file: string): ImageInput {
    const extension = file.split('.').pop() ?? '';
    return { path: this.path(file), mediaType: MEDIA_TYPES[extension] ?? 'image/png' };
  }
}
