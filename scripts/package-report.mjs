import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/** Read the central directory of the non-ZIP64 archives emitted by vsce. */
function zipEntries(buffer) {
  let end = buffer.length - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= minimum, 'Missing ZIP central directory');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  assert.notEqual(count, 0xffff, 'ZIP64 is not supported');
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      path: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
      compressedBytes: buffer.readUInt32LE(offset + 20),
      bytes: buffer.readUInt32LE(offset + 24),
      method: buffer.readUInt16LE(offset + 10),
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries.filter((entry) => !entry.path.endsWith('/'));
}

function contents(buffer, entry) {
  const offset = entry.localOffset;
  assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
  const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
  const compressed = buffer.subarray(start, start + entry.compressedBytes);
  if (entry.method === 0) return compressed;
  assert.equal(entry.method, 8, 'Unsupported ZIP compression');
  return inflateRawSync(compressed);
}

export async function reportPackage(file) {
  const buffer = await readFile(file);
  const entries = zipEntries(buffer);
  const names = new Set(entries.map((entry) => entry.path));
  const runtime = JSON.parse(await readFile('.build-reports/runtime-files.json', 'utf8'));
  const runtimeNames = new Set(runtime.map((path) => `extension/${path}`));
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  for (const path of [
    ...runtime,
    'package.json',
    'readme.md',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.md',
    'media/mascot/icon.png',
    'media/claudex-icon.png',
    'docs/usage.md',
    'docs/visual-guide.md',
    ...manifest.contributes.walkthroughs.flatMap((walkthrough) =>
      walkthrough.steps.map((step) => step.media.markdown),
    ),
  ])
    assert.ok(names.has(`extension/${path}`), `Missing package resource: ${path}`);
  for (const entry of entries) {
    if (entry.path.startsWith('extension/dist/'))
      assert.ok(runtimeNames.has(entry.path), `Unexpected generated resource: ${entry.path}`);
    assert.ok(
      !/^extension\/(?:src|scripts|tests|plans|releases|node_modules|\.build-reports|\.github)\//.test(
        entry.path,
      ) &&
        !entry.path.endsWith('.map') &&
        !/^extension\/media\/guide\/.*\.gif$/.test(entry.path) &&
        !/^extension\/media\/mascot\/(?!icon\.png$)/.test(entry.path),
      `Development or duplicate resource packaged: ${entry.path}`,
    );
  }
  // Installed guides must retain every local image target. vsce may rewrite README images online.
  for (const path of [
    'extension/readme.md',
    'extension/docs/usage.md',
    'extension/docs/visual-guide.md',
  ]) {
    const entry = entries.find((entry) => entry.path === path);
    assert.ok(entry);
    const markdown = contents(buffer, entry).toString('utf8');
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+\.(?:png|gif))\)/g)) {
      const target = match[1];
      if (/^https?:/.test(target)) continue;
      const normalized = new URL(target, `https://package/${path}`).pathname.slice(1);
      assert.ok(names.has(normalized), `Broken guide image: ${path} -> ${target}`);
    }
  }
  const report = {
    archiveBytes: buffer.length,
    uncompressedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    fileCount: entries.length,
    initialWebviewJavaScriptBytes: entries.find(
      (entry) => entry.path === 'extension/dist/webview.js',
    )?.bytes,
    lazyChunkBytes: entries
      .filter((entry) => entry.path.startsWith('extension/dist/chunks/'))
      .reduce((sum, entry) => sum + entry.bytes, 0),
    largest: [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, 20),
    entries,
  };
  await writeFile('.build-reports/package.json', JSON.stringify(report, null, 2));
  console.log(
    `Verified VSIX: ${report.archiveBytes} compressed bytes; ${report.uncompressedBytes} unpacked bytes; ${report.fileCount} files.`,
  );
  return report;
}
