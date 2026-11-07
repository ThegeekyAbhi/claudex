import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionPersistence } from '../../../../src/application/sessions/session-persistence';
import type { Session } from '../../../../src/shared/model';

function session(): Session {
  return {
    id: 'local-session',
    provider: 'claude',
    title: 'A thread',
    cwd: '/project',
    workspace: '/project',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

test('persistence writes the exact legacy format and round-trips local and native identities', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-persistence-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const thread: Session = {
    id: 'local-id',
    provider: 'claude',
    profileId: 'claud2',
    title: 'Saved',
    cwd: '/project',
    workspace: '/project',
    nativeId: 'native-id',
    status: 'failed',
    messages: [{ id: 'm1', role: 'assistant', text: 'Unfinished' }],
    createdAt: 1,
    updatedAt: 2,
    approval: { id: 'pending', title: 'Tool', detail: '' },
    transition: 'stopping',
  };
  const expected =
    '{"version":1,"sessions":[{"id":"local-id","provider":"claude","profileId":"claud2","title":"Saved","cwd":"/project","workspace":"/project","nativeId":"native-id","status":"failed","messages":[{"id":"m1","role":"assistant","text":"Unfinished"}],"createdAt":1,"updatedAt":2,"claudeCommand":"claud2"}]}';
  const persistence = new SessionPersistence({ storage, sessions: [thread] });
  await persistence.flush();
  const file = path.join(storage, 'sessions.json');
  assert.equal(await readFile(file, 'utf8'), expected);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  const restored: Session[] = [];
  const reader = new SessionPersistence({ storage, sessions: restored });
  await reader.load();
  assert.equal(restored[0].id, 'local-id');
  assert.equal(restored[0].nativeId, 'native-id');
  assert.equal(restored[0].profileId, 'claud2');
  assert.equal(restored[0].status, 'failed');
  assert.equal(restored[0].approval, undefined);
  assert.equal(restored[0].transition, undefined);
  assert.equal(reader.serialize(), expected);
  await reader.flush();
  assert.equal(await readFile(file, 'utf8'), expected);
});

test('an unchanged persistence instance never overwrites a different window’s newer file', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-idle-store-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const sessions = [session()];
  const writer = new SessionPersistence({ storage, sessions });
  await writer.flush();
  const idle = new SessionPersistence({ storage, sessions: [] });
  await idle.load();
  sessions[0].title = 'Newer';
  await writer.flush();
  const file = path.join(storage, 'sessions.json');
  const newer = await readFile(file, 'utf8');
  await idle.flush();
  assert.equal(await readFile(file, 'utf8'), newer);
});

test('persistence queues snapshots in order and recovers after a failed write', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-save-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = path.join(root, 'store');
  await writeFile(storage, 'blocking file');
  const thread = session();
  const persistence = new SessionPersistence({ storage, sessions: [thread] });
  await assert.rejects(persistence.flush());
  assert.equal(await readFile(storage, 'utf8'), 'blocking file');
  await rm(storage);
  const first = persistence.flush();
  thread.title = 'Second snapshot';
  const second = persistence.flush();
  await Promise.all([first, second]);
  const saved = JSON.parse(await readFile(path.join(storage, 'sessions.json'), 'utf8'));
  assert.equal(saved.sessions[0].title, 'Second snapshot');
  assert.equal(saved.sessions[0].id, thread.id);
});

test('load preserves corrupt files and missing storage remains empty', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-corrupt-store-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const sessions: Session[] = [];
  const persistence = new SessionPersistence({ storage, sessions });
  await persistence.load();
  assert.deepEqual(sessions, []);
  const file = path.join(storage, 'sessions.json');
  await writeFile(file, 'invalid json');
  await assert.rejects(persistence.load(), /stored files were preserved/);
  assert.equal(await readFile(file, 'utf8'), 'invalid json');
  assert.deepEqual(sessions, []);
});

test('save scheduling coalesces changes at the original deadline and flush cancels the timer', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'aw-save-schedule-'));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const persistence = new SessionPersistence({ storage, sessions: [] });
  await persistence.load();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let flushes = 0;
  let flushed = Promise.resolve();
  const schedule = {
    delayMs: 100,
    flush: () => {
      flushes++;
      flushed = persistence.flush();
      return flushed;
    },
    onError: (error: unknown) => assert.fail(String(error)),
  };
  persistence.scheduleSave(schedule);
  t.mock.timers.tick(50);
  persistence.scheduleSave(schedule);
  t.mock.timers.tick(49);
  assert.equal(flushes, 0);
  t.mock.timers.tick(1);
  assert.equal(flushes, 1, 'later changes do not move the first scheduled deadline');
  await flushed;
  persistence.scheduleSave(schedule);
  await persistence.flush();
  t.mock.timers.tick(100);
  assert.equal(flushes, 1, 'an explicit flush cancels the scheduled save');
});
