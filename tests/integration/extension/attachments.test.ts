import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fuzzyScore, resolveAttachments, searchContext } from '../../../src/extension/attachments';
import { ImageStore, sniffImage } from '../../../src/providers/shared/image-store';
import { actionSchema, restoreSessions, type Session } from '../../../src/shared/model';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAI', 'base64');
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-attach-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/a.ts'), 'export {};');
  await writeFile(path.join(root, 'src/shot.png'), PNG);
  const store = new ImageStore(path.join(root, '.store'));
  return { root, store, options: { root, store, sessions: [] as Session[] } };
}
test('the image store checks real content and keeps only its own file names', async () => {
  const { store } = await setup();
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(Buffer.from('<svg onload="x()">')), undefined);
  await assert.rejects(store.save(Buffer.from('not an image')), /Only PNG/);
  await assert.rejects(store.save(PNG, 4), /at most/);
  const file = await store.save(PNG);
  assert.match(file, /^[0-9a-f-]{36}\.png$/);
  assert.equal(store.input(file).mediaType, 'image/png');
  assert.throws(() => store.path('../../secret.png'), /Unknown image/);
});
test('attachments stay inside the workspace', async () => {
  const { root, options } = await setup();
  await assert.rejects(
    resolveAttachments([{ kind: 'file', path: '../outside.ts' }], options),
    /ENOENT|outside/,
  );
  await assert.rejects(
    resolveAttachments([{ kind: 'file', path: '/etc/passwd' }], options),
    /workspace-relative/,
  );
  const outside = await mkdtemp(path.join(tmpdir(), 'aw-outside-'));
  await writeFile(path.join(outside, 'secret.ts'), 'x');
  await symlink(path.join(outside, 'secret.ts'), path.join(root, 'link.ts'));
  await assert.rejects(resolveAttachments([{ kind: 'file', path: 'link.ts' }], options), /outside/);
});
test('files go as paths, workspace images as images, and text context is capped', async () => {
  const { root, options } = await setup();
  const thread = {
    id: 't1',
    title: 'Earlier',
    messages: [{ id: 'a', role: 'assistant', text: 'x'.repeat(9_000) }],
  } as Session;
  const result = await resolveAttachments(
    [
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'folder', path: 'src' },
      { kind: 'file', path: 'src/shot.png' },
      { kind: 'thread', id: 't1' },
      { kind: 'terminal', name: 'zsh' },
    ],
    { ...options, sessions: [thread], terminal: () => '$ ls\nfile' },
  );
  assert.match(result.context ?? '', /- src\/a\.ts\n- src\//);
  assert.match(result.context ?? '', /Cut off here/);
  assert.match(result.context ?? '', /\$ ls\nfile/);
  assert.equal(result.images?.length, 1);
  assert.ok(result.images?.[0].path.startsWith(path.join(root, '.store')));
  assert.equal(result.attachments?.[2].kind, 'image');
  assert.equal(result.attachments?.[3].kind, 'thread');
  await assert.rejects(
    resolveAttachments([{ kind: 'terminal', name: 'gone' }], options),
    /no output/,
  );
});
test('a branch diff compares with the main branch, and says when there is nothing', async () => {
  const { root, options } = await setup();
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', 'src');
  git('commit', '-qm', 'one');
  const empty = await resolveAttachments([{ kind: 'diff' }], options);
  assert.match(empty.context ?? '', /no committed differences from main/);
  git('checkout', '-qb', 'work');
  await writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;');
  git('commit', '-qam', 'two');
  const changed = await resolveAttachments([{ kind: 'diff' }], options);
  assert.match(changed.context ?? '', /compared with main/);
  assert.match(changed.context ?? '', /\+export const a = 1;/);
});
test('search favours file names and offers folders', () => {
  const files = ['src/webview/composer.tsx', 'docs/compose-notes.md', 'src/model.ts'];
  assert.deepEqual(searchContext(files, 'composer')[0], {
    kind: 'file',
    path: 'src/webview/composer.tsx',
  });
  assert.ok(searchContext(files, 'webview').some((item) => item.kind === 'folder'));
  assert.equal(fuzzyScore('zzz', 'src/model.ts'), undefined);
  assert.ok(searchContext(files, '').length <= 12);
});
test('webview messages with bad attachments are rejected', () => {
  const send = { type: 'send', id: 'a', text: 'hi' };
  assert.ok(actionSchema.safeParse({ ...send, attachments: [{ kind: 'diff' }] }).success);
  for (const bad of [
    { kind: 'image', file: '../../x.png', name: 'x' },
    { kind: 'image', file: 'x.svg', name: 'x' },
    { kind: 'file', path: '' },
    { kind: 'unknown' },
  ])
    assert.equal(actionSchema.safeParse({ ...send, attachments: [bad] }).success, false);
  assert.equal(actionSchema.safeParse({ type: 'openImage', file: '/etc/passwd' }).success, false);
});
test('threads from older versions restore, and unfinished work does not claim to run', () => {
  const base = {
    id: 's',
    provider: 'codex',
    title: 't',
    cwd: '/',
    workspace: '/',
    createdAt: 1,
    updatedAt: 1,
  };
  const [older] = restoreSessions({
    version: 1,
    sessions: [{ ...base, status: 'completed', messages: [{ id: 'm', role: 'user', text: 'hi' }] }],
  });
  assert.equal(older.mode, undefined);
  const [unfinished] = restoreSessions({
    version: 1,
    sessions: [
      {
        ...base,
        status: 'running',
        plan: { text: 'half', status: 'drafting', updatedAt: 1 },
        messages: [{ id: 'i', role: 'image', text: '', image: { status: 'generating' } }],
      },
    ],
  });
  assert.equal(unfinished.status, 'interrupted');
  assert.equal(unfinished.plan?.status, 'incomplete');
  assert.equal(unfinished.messages[0].image?.status, 'failed');
});

test('image reference numbers survive validation and map to provider image order', async () => {
  const { root, options } = await setup();
  const file = await options.store.copy(path.join(root, 'src/shot.png'), 10 * 1024 * 1024);
  const result = await resolveAttachments(
    [{ kind: 'image', file, name: 'shot.png', reference: 3 }],
    options,
  );
  assert.equal(result.images?.length, 1);
  assert.match(result.context ?? '', /Image attachment 1 is \[Image #3\]/);
  assert.equal(result.attachments?.[0].kind === 'image' && result.attachments[0].reference, 3);
});
