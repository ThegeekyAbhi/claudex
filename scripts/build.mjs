import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist/chunks', { recursive: true, force: true });
await Promise.all([
  build({
    entryPoints: ['src/host/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: 'dist/extension.cjs',
    external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/webview/lib/markdown-preview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/markdown-preview.js',
    minify: true,
  }),
  build({
    entryPoints: ['src/webview/app/main.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    splitting: true,
    target: 'es2022',
    outdir: 'dist',
    entryNames: 'webview',
    chunkNames: 'chunks/[name]-[hash]',
    minify: true,
    sourcemap: true,
    loader: { '.woff2': 'file' },
    assetNames: 'fonts/[name]',
  }),
]);

// Tailwind compiles to a plain stylesheet, so the webview's CSP needs no inline styles.
execFileSync(
  'node_modules/.bin/tailwindcss',
  ['-i', 'src/webview/app/index.css', '-o', 'dist/app.css', '--minify'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

// The SDK must retain its ESM import and assets; ship it next to the CJS extension.
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/node_modules/@anthropic-ai', { recursive: true });
await cp(
  'node_modules/@anthropic-ai/claude-agent-sdk',
  'dist/node_modules/@anthropic-ai/claude-agent-sdk',
  { recursive: true, dereference: true },
);
