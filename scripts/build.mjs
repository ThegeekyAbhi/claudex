import { build } from 'esbuild';

await Promise.all([
  build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: 'dist/extension.cjs',
    external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/webview/main.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/webview.js',
    minify: true,
    sourcemap: true,
    loader: { '.woff2': 'file' },
    assetNames: 'fonts/[name]',
  }),
]);

// The SDK must retain its ESM import and assets; ship it next to the CJS extension.
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/node_modules/@anthropic-ai', { recursive: true });
await cp(
  'node_modules/@anthropic-ai/claude-agent-sdk',
  'dist/node_modules/@anthropic-ai/claude-agent-sdk',
  { recursive: true, dereference: true },
);
