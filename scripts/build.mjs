import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runBin } from './bin.mjs';

// dist is exclusively generated; start clean so stale bundles cannot enter a release.
await rm('dist', { recursive: true, force: true });
await mkdir('.build-reports', { recursive: true });
const results = await Promise.all([
  build({
    entryPoints: ['src/extension/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: 'dist/extension.cjs',
    external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
    minify: true,
    sourcemap: true,
    metafile: true,
  }),
  build({
    entryPoints: ['src/webview/lib/markdown-preview.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/markdown-preview.js',
    minify: true,
    metafile: true,
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
    metafile: true,
  }),
]);

await Promise.all(
  results.map((result, index) =>
    writeFile(
      `.build-reports/${['extension', 'markdown-preview', 'webview'][index]}.meta.json`,
      JSON.stringify(result.metafile, null, 2),
    ),
  ),
);

const contributions = results.map(({ metafile }) => {
  const modules = new Map();
  for (const output of Object.values(metafile.outputs))
    for (const [name, input] of Object.entries(output.inputs))
      modules.set(name, (modules.get(name) ?? 0) + input.bytesInOutput);
  return [...modules].map(([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes);
});
const previewModules = new Map(contributions[1].map((entry) => [entry.path, entry.bytes]));
const overlap = contributions[2]
  .filter((entry) => previewModules.has(entry.path))
  .map((entry) => ({ ...entry, previewBytes: previewModules.get(entry.path) }));
await writeFile(
  '.build-reports/bundles.json',
  JSON.stringify(
    {
      builds: Object.fromEntries(
        ['extension', 'markdown-preview', 'webview'].map((name, index) => [
          name,
          contributions[index],
        ]),
      ),
      previewWebviewOverlap: overlap,
    },
    null,
    2,
  ),
);

// Tailwind compiles to a plain stylesheet, so the webview's CSP needs no inline styles.
runBin(
  '@tailwindcss/cli',
  'tailwindcss',
  ['-i', 'src/webview/app/index.css', '-o', 'dist/app.css', '--minify'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

// The SDK must retain its ESM import and assets; ship it next to the CJS extension.
await mkdir('dist/mascot', { recursive: true });
for (const activity of ['working', 'thinking', 'planning', 'coding', 'reading', 'attentive'])
  await cp(`media/mascot/${activity}.png`, `dist/mascot/${activity}.png`);
await mkdir('dist/node_modules/@anthropic-ai', { recursive: true });
await cp(
  'node_modules/@anthropic-ai/claude-agent-sdk',
  'dist/node_modules/@anthropic-ai/claude-agent-sdk',
  { recursive: true, dereference: true },
);

async function runtimeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? runtimeFiles(file) : file;
    }),
  );
  return files
    .flat()
    .filter((file) => !file.endsWith('.map'))
    .sort();
}
await writeFile(
  '.build-reports/runtime-files.json',
  JSON.stringify(await runtimeFiles('dist'), null, 2),
);
