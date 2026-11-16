import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillCache } from '../../../../src/application/catalogs/skill-cache';

function pending() {
  let resolve!: (value: { skills: []; problems: string[] }) => void;
  const promise = new Promise<{ skills: []; problems: string[] }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('forced refresh cancels older work and cannot publish its late result', async () => {
  const cache = new SkillCache();
  const old = pending();
  let signal!: AbortSignal;
  const first = cache.load(
    'project-a',
    false,
    (received) => {
      signal = received;
      return old.promise;
    },
    () => {},
  );
  await Promise.resolve();
  await cache.load(
    'project-a',
    true,
    async () => ({ skills: [], problems: ['new'] }),
    () => {},
  );
  assert.equal(signal.aborted, true);
  old.resolve({ skills: [], problems: ['old'] });
  await first;
  assert.deepEqual(cache.get('project-a').problems, ['new']);
});

test('contexts stay separate; failed refresh retains stale inventory and clear invalidates in-flight work', async () => {
  const cache = new SkillCache();
  await cache.load(
    'profile-a:cwd-a',
    false,
    async () => ({ skills: [], problems: ['a'] }),
    () => {},
  );
  await cache.load(
    'profile-b:cwd-b',
    false,
    async () => ({ skills: [], problems: ['b'] }),
    () => {},
  );
  await cache.load(
    'profile-a:cwd-a',
    true,
    async () => {
      throw new Error('secret stderr');
    },
    () => {},
  );
  assert.equal(cache.get('profile-a:cwd-a').stale, true);
  assert.deepEqual(cache.get('profile-a:cwd-a').problems, ['a']);
  assert.deepEqual(cache.get('profile-b:cwd-b').problems, ['b']);
  assert.ok(!JSON.stringify(cache.get('profile-a:cwd-a')).includes('secret stderr'));
  const old = pending();
  let published = 0;
  const first = cache.load(
    'pending',
    false,
    () => old.promise,
    () => published++,
  );
  await Promise.resolve();
  cache.clear();
  old.resolve({ skills: [], problems: ['late'] });
  await first;
  assert.equal(published, 1);
  assert.equal(cache.get('pending').status, 'idle');
});
