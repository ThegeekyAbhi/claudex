import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Small file helpers the page and asset stores share. */

/** The names, without `.md`, of the Markdown files directly in a folder. */
export async function markdownIds(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name.slice(0, -3));
  } catch {
    return [];
  }
}
/**
 * Writes through a temporary file and a rename, so a reader never sees half a file. Files are
 * private to you. `wx` refuses to replace a file that exists.
 */
export async function atomicWrite(
  file: string,
  data: string | Uint8Array,
  flag: 'w' | 'wx' = 'w',
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  if (flag === 'wx') {
    await writeFile(file, data, { mode: 0o600, flag: 'wx' }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    return;
  }
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
