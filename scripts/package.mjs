import { mkdir, readFile } from 'node:fs/promises';
import { runBin } from './bin.mjs';

const { name, version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('releases', { recursive: true });
runBin(
  '@vscode/vsce',
  'vsce',
  [
    'package',
    '--no-dependencies',
    '--githubBranch',
    'main',
    '--out',
    `releases/${name}-${version}.vsix`,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
