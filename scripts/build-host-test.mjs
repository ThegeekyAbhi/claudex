import { build } from 'esbuild';

await build({
  entryPoints: ['tests/host-suite.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/host-tests.cjs',
  external: ['vscode'],
});
