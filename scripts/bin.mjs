import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Runs a dev tool's own JavaScript entry with this Node, instead of the launcher in
 * node_modules/.bin. Those launchers are shell scripts on macOS/Linux and .cmd files on Windows,
 * which Node can't start directly there, so this works the same on every OS.
 */
export function runBin(pkg, bin, args, options = {}) {
  const root = path.join('node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[bin];
  if (!entry) throw new Error(`${pkg} has no “${bin}” program.`);
  execFileSync(process.execPath, [path.join(root, entry), ...args], options);
}
