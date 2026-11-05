import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';

const { name, version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('releases', { recursive: true });
execFileSync(
  'vsce',
  [
    'package',
    '--no-dependencies',
    '--allow-missing-repository',
    '--out',
    `releases/${name}-${version}.vsix`,
  ],
  { stdio: 'inherit' },
);
