import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes a stand-in provider CLI that runs `source` with this Node. On macOS and Linux it is a
 * `#!` script; on Windows, which can't run those, it is a .cmd launcher beside a .js file, the
 * same shape as npm's global installs, so tests there go through Claudex's real .cmd launch path.
 * Returns the path to start.
 */
export async function writeFakeCli(folder: string, name: string, source: string): Promise<string> {
  if (process.platform !== 'win32') {
    const file = path.join(folder, name);
    await writeFile(file, `#!${process.execPath}\n${source}`, { mode: 0o700 });
    return file;
  }
  await writeFile(path.join(folder, `${name}.js`), source);
  const launcher = path.join(folder, `${name}.cmd`);
  await writeFile(launcher, `@"${process.execPath}" "%~dp0${name}.js" %*\r\n`);
  return launcher;
}
