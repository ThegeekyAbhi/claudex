import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { Sessions } from '../../../src/application/sessions/session-manager';
import { FileObserver, type ObservedChanges } from '../../../src/infrastructure/file-observer';
import { type EventSink, restoreSessions } from '../../../src/shared/model';

const execute = promisify(execFile);
async function checkout(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-observer-'));
  await execute('git', ['init', '-q', root]);
  return root;
}
async function checkpoint(observer: FileObserver): Promise<ObservedChanges> {
  let result: ObservedChanges | undefined;
  observer.checkpoint((value) => {
    result = value;
  });
  await observer.flush();
  assert.ok(result);
  return result;
}

test('checkpoints show only new disk edits, including shell writes, additions and deletions', async () => {
  const root = await checkout();
  try {
    await writeFile(path.join(root, 'existing.txt'), 'committed\n');
    await execute('git', ['-C', root, 'add', 'existing.txt']);
    await writeFile(path.join(root, 'existing.txt'), 'already dirty\n');
    const observer = await FileObserver.start(root);
    assert.deepEqual((await checkpoint(observer)).diffs, []);
    await execute('/bin/sh', ['-c', "printf 'after shell\\n' > existing.txt"], { cwd: root });
    const first = await checkpoint(observer);
    assert.equal(first.diffs.length, 1);
    assert.match(first.diffs[0].patch, /-already dirty\n\+after shell/);
    assert.doesNotMatch(first.diffs[0].patch, /committed/);
    assert.deepEqual((await checkpoint(observer)).diffs, []);
    await writeFile(path.join(root, 'new.txt'), 'new\n');
    await rm(path.join(root, 'existing.txt'));
    const second = await checkpoint(observer);
    assert.equal(second.diffs.find((diff) => diff.path === 'new.txt')?.kind, 'add');
    assert.equal(second.diffs.find((diff) => diff.path === 'existing.txt')?.kind, 'delete');
    await rename(path.join(root, 'new.txt'), path.join(root, 'renamed.txt'));
    const renamed = await checkpoint(observer);
    assert.equal(
      renamed.diffs.length,
      2,
      'shell renames are represented as deletion plus addition',
    );
    observer.release();
    await observer.flush();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capture excludes ignored files and symlinks and reports binary and oversized changes', async () => {
  const root = await checkout();
  const outside = await mkdtemp(path.join(tmpdir(), 'aw-outside-'));
  try {
    await writeFile(path.join(root, '.gitignore'), 'ignored/\n');
    await mkdir(path.join(root, 'ignored'));
    await writeFile(path.join(root, 'ignored', 'secret'), 'never capture');
    await writeFile(path.join(outside, 'secret'), 'never capture');
    await symlink(path.join(outside, 'secret'), path.join(root, 'link'));
    const observer = await FileObserver.start(root);
    await writeFile(path.join(root, 'large'), 'x'.repeat(256 * 1024 + 1));
    await writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    const result = await checkpoint(observer);
    assert.deepEqual(result.diffs.map((diff) => diff.path).sort(), ['binary', 'large']);
    assert.equal(result.diffs.find((diff) => diff.path === 'binary')?.binary, true);
    assert.equal(result.diffs.find((diff) => diff.path === 'large')?.truncated, true);
    assert.match(result.note ?? '', /skipped/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('native edit diffs are not repeated, and unavailable capture is explicit', async () => {
  const root = await checkout();
  const plain = await mkdtemp(path.join(tmpdir(), 'aw-not-git-'));
  try {
    await writeFile(path.join(root, 'a'), 'before');
    const observer = await FileObserver.start(root);
    await writeFile(path.join(root, 'a'), 'after');
    let result: ObservedChanges | undefined;
    observer.checkpoint(
      (value) => {
        result = value;
      },
      [
        {
          path: 'a',
          kind: 'update',
          patch: '@@ edit @@\n-before\n+after',
          additions: 1,
          deletions: 1,
        },
      ],
    );
    await observer.flush();
    assert.deepEqual(result?.diffs, []);
    const missing = await checkpoint(await FileObserver.start(plain));
    assert.deepEqual(missing.diffs, []);
    assert.match(missing.note ?? '', /unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(plain, { recursive: true, force: true });
  }
});

test('session observations survive failed commands, interruption, restoration and a later turn', async () => {
  const root = await checkout();
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-observer-storage-'));
  let sink: EventSink | undefined;
  const manager = new Sessions(
    storage,
    (_session, emit) => {
      sink = emit;
      return { send: async () => {}, interrupt: async () => {}, dispose() {} };
    },
    60_000,
  );
  try {
    await writeFile(path.join(root, 'a'), 'before');
    const session = manager.create('codex', root, root, 'Edits');
    await manager.send(session.id, 'edit');
    assert.ok(sink);
    sink({
      type: 'message',
      message: {
        id: 'cmd',
        role: 'tool',
        text: '',
        tool: {
          kind: 'command',
          name: 'command',
          title: 'edit then fail',
          status: 'running',
        },
      },
    });
    await writeFile(path.join(root, 'a'), 'partial');
    sink({ type: 'patch', id: 'cmd', tool: { status: 'failed' } });
    await manager.interrupt(session.id);
    const observation = session.messages.find((message) => message.tool?.diffSource);
    assert.equal(session.messages.find((message) => message.id === 'cmd')?.tool?.status, 'failed');
    assert.match(observation?.tool?.diffs?.[0].patch ?? '', /\+partial/);
    const [restored] = restoreSessions({ version: 1, sessions: [session] });
    assert.equal(
      restored.messages.find((message) => message.tool?.diffSource)?.tool?.diffs?.length,
      1,
    );
    await manager.send(session.id, 'next');
    await writeFile(path.join(root, 'a'), 'next');
    sink({ type: 'status', status: 'completed' });
    // Starting another turn drains the completed turn's pending comparisons first.
    await manager.send(session.id, 'read only');
    const observations = session.messages.filter((message) => message.tool?.diffSource);
    assert.equal(observations.length, 2);
    assert.match(observations[1].tool?.diffs?.[0].patch ?? '', /-partial\n\+next/);
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  }
});

test('queued comparisons preserve concurrent changes once and report a lost checkout', async () => {
  const root = await checkout();
  try {
    await writeFile(path.join(root, 'a'), 'before');
    const observer = await FileObserver.start(root);
    await writeFile(path.join(root, 'a'), 'parallel edits');
    const results: ObservedChanges[] = [];
    observer.checkpoint((value) => results.push(value));
    observer.checkpoint((value) => results.push(value));
    await observer.flush();
    assert.equal(results.flatMap((value) => value.diffs).length, 1);
    await rename(path.join(root, '.git'), path.join(root, 'lost-git'));
    const lost = await checkpoint(observer);
    assert.equal(lost.diffs.length, 0);
    assert.match(lost.note ?? '', /unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('delayed command observations request a full snapshot when inserted into older activity', async () => {
  const root = await checkout();
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-delayed-storage-'));
  let sink: EventSink | undefined;
  const manager = new Sessions(
    storage,
    (_session, emit) => {
      sink = emit;
      return { send: async () => {}, interrupt: async () => {}, dispose() {} };
    },
    60_000,
  );
  let full = false;
  manager.on('change', (value?: boolean) => {
    full ||= value === true;
  });
  try {
    await writeFile(path.join(root, 'a'), 'before');
    const session = manager.create('codex', root, root, 'Delayed edits');
    await manager.send(session.id, 'edit');
    assert.ok(sink);
    sink({
      type: 'message',
      message: {
        id: 'old-command',
        role: 'tool',
        text: '',
        tool: {
          kind: 'command',
          name: 'command',
          title: 'shell edit',
          status: 'running',
        },
      },
    });
    for (let index = 0; index < 20; index++) {
      sink({
        type: 'message',
        message: { id: `text-${index}`, role: 'assistant', text: 'Progress' },
      });
    }
    await writeFile(path.join(root, 'a'), 'after');
    sink({ type: 'patch', id: 'old-command', tool: { status: 'completed' } });
    await manager.interrupt(session.id);
    const index = session.messages.findIndex((message) => message.id === 'old-command');
    assert.equal(session.messages[index + 1].tool?.diffSource, 'filesystem');
    assert.equal(full, true, 'older insertion must not be lost outside a streaming tail');
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  }
});
