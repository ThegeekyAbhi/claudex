import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  candidateNames,
  defaultSearchHost,
  describeMissing,
  knownFolders,
  locateExecutable,
  type SearchHost,
} from '../../../src/extension/agent-paths';

type Entry = 'runnable' | 'notExecutable' | 'folder' | 'script';

/** A machine that exists only as a list of paths, so every OS can be checked from any OS. */
function fakeHost(
  platform: NodeJS.Platform,
  files: Record<string, Entry>,
  env: NodeJS.ProcessEnv,
  home: string,
): SearchHost {
  const key = (file: string) => (platform === 'win32' ? file.toLowerCase() : file);
  const table = new Map(Object.entries(files).map(([file, entry]) => [key(file), entry]));
  return {
    platform,
    env,
    home,
    probe: (file) => {
      const entry = table.get(key(file));
      return entry === 'script' ? 'runnable' : entry;
    },
    isScript: (file) => table.get(key(file)) === 'script',
  };
}

const WIN_ENV = {
  Path: 'C:\\Windows\\system32;C:\\Program Files\\nodejs',
  APPDATA: 'C:\\Users\\Ana Lú\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Ana Lú\\AppData\\Local',
};
const WIN_HOME = 'C:\\Users\\Ana Lú';

test('Windows never runs a bare name, and prefers .exe over a .cmd launcher', () => {
  assert.deepEqual(candidateNames('codex', 'win32'), [
    'codex.exe',
    'codex.cmd',
    'codex.bat',
    'codex.com',
  ]);
  assert.deepEqual(candidateNames('codex.CMD', 'win32'), ['codex.CMD']);
  assert.deepEqual(candidateNames('codex', 'linux'), ['codex']);
});

test('Windows finds npm’s codex.cmd in %APPDATA%\\npm, not the shell script beside it', () => {
  const host = fakeHost(
    'win32',
    {
      'C:\\Users\\Ana Lú\\AppData\\Roaming\\npm\\codex': 'runnable',
      'C:\\Users\\Ana Lú\\AppData\\Roaming\\npm\\codex.cmd': 'runnable',
    },
    WIN_ENV,
    WIN_HOME,
  );
  assert.deepEqual(locateExecutable('codex', host).found, {
    path: 'C:\\Users\\Ana Lú\\AppData\\Roaming\\npm\\codex.cmd',
    origin: 'knownFolder',
    kind: 'launcher',
  });
});

test('Windows finds Claude’s native installer in %USERPROFILE%\\.local\\bin', () => {
  const host = fakeHost(
    'win32',
    { 'C:\\Users\\Ana Lú\\.local\\bin\\claude.exe': 'runnable' },
    WIN_ENV,
    WIN_HOME,
  );
  assert.deepEqual(locateExecutable('claude', host).found, {
    path: 'C:\\Users\\Ana Lú\\.local\\bin\\claude.exe',
    origin: 'knownFolder',
    kind: 'native',
  });
});

test('Windows reads PATH whatever its case, and PATH comes before known folders', () => {
  const host = fakeHost(
    'win32',
    {
      'C:\\Program Files\\nodejs\\codex.cmd': 'runnable',
      'C:\\Users\\Ana Lú\\AppData\\Roaming\\npm\\codex.cmd': 'runnable',
    },
    WIN_ENV,
    WIN_HOME,
  );
  assert.deepEqual(locateExecutable('codex', host).found, {
    path: 'C:\\Program Files\\nodejs\\codex.cmd',
    origin: 'path',
    kind: 'launcher',
  });
});

test('Windows: an .exe in one folder doesn’t beat a launcher earlier on PATH', () => {
  // PATH order is the user's choice, exactly as in their terminal.
  const host = fakeHost(
    'win32',
    {
      'C:\\Program Files\\nodejs\\codex.cmd': 'runnable',
      'C:\\Users\\Ana Lú\\.local\\bin\\codex.exe': 'runnable',
    },
    WIN_ENV,
    WIN_HOME,
  );
  assert.equal(locateExecutable('codex', host).found?.path, 'C:\\Program Files\\nodejs\\codex.cmd');
});

test('Windows: a configured path without an extension finds the .exe beside it', () => {
  const host = fakeHost('win32', { 'D:\\tools\\codex.exe': 'runnable' }, WIN_ENV, WIN_HOME);
  assert.deepEqual(locateExecutable('D:\\tools\\codex', host).found, {
    path: 'D:\\tools\\codex.exe',
    origin: 'setting',
    kind: 'native',
  });
  assert.equal(locateExecutable('D:\\tools\\missing.exe', host).found, undefined);
});

test('Windows known folders follow the environment and skip what is unset', () => {
  const folders = knownFolders(fakeHost('win32', {}, { PNPM_HOME: 'E:\\pnpm' }, WIN_HOME));
  assert.ok(folders.includes('E:\\pnpm'));
  assert.ok(folders.includes('C:\\Users\\Ana Lú\\.local\\bin'));
  assert.ok(!folders.some((folder) => folder.includes('undefined')));
  assert.ok(folders.every((folder) => !folder.includes('/')));
});

test('macOS finds Homebrew and the native installer when the Dock gave VS Code a short PATH', () => {
  const home = '/Users/ana';
  const env = { PATH: '/usr/bin:/bin' };
  const host = fakeHost(
    'darwin',
    { '/opt/homebrew/bin/codex': 'script', '/Users/ana/.local/bin/claude': 'runnable' },
    env,
    home,
  );
  assert.deepEqual(locateExecutable('codex', host).found, {
    path: '/opt/homebrew/bin/codex',
    origin: 'knownFolder',
    kind: 'launcher',
  });
  assert.deepEqual(locateExecutable('claude', host).found, {
    path: '/Users/ana/.local/bin/claude',
    origin: 'knownFolder',
    kind: 'native',
  });
});

test('Linux finds Linuxbrew and npm-global installs, and not macOS-only folders', () => {
  const home = '/home/ana';
  const folders = knownFolders(fakeHost('linux', {}, {}, home));
  assert.ok(folders.includes('/home/linuxbrew/.linuxbrew/bin'));
  assert.ok(folders.includes('/home/ana/.npm-global/bin'));
  assert.ok(!folders.includes('/opt/homebrew/bin'));
  const host = fakeHost('linux', { '/home/ana/.npm-global/bin/codex': 'script' }, {}, home);
  assert.equal(locateExecutable('codex', host).found?.path, '/home/ana/.npm-global/bin/codex');
});

test('a folder or a file without run permission is skipped, and the reason kept', () => {
  const host = fakeHost(
    'linux',
    { '/a/codex': 'folder', '/b/codex': 'notExecutable', '/c/codex': 'runnable' },
    { PATH: '/a:/b:/c' },
    '/home/ana',
  );
  const search = locateExecutable('codex', host);
  assert.equal(search.found?.path, '/c/codex');
  assert.deepEqual(search.rejected, [
    { path: '/a/codex', reason: 'folder' },
    { path: '/b/codex', reason: 'notExecutable' },
  ]);
  const missing = locateExecutable(
    'codex',
    fakeHost('linux', { '/b/codex': 'notExecutable' }, { PATH: '/b' }, '/x'),
  );
  assert.equal(missing.found, undefined);
  assert.match(describeMissing('codex', missing) ?? '', /isn’t allowed to run/);
  assert.equal(describeMissing('codex', { rejected: [] }), undefined);
});

test('relative PATH entries are ignored, and ~ means the home folder', () => {
  const host = fakeHost(
    'darwin',
    { 'bin/codex': 'runnable', '/Users/ana/tools/codex': 'runnable' },
    { PATH: 'bin' },
    '/Users/ana',
  );
  assert.equal(locateExecutable('codex', host).found, undefined);
  assert.deepEqual(locateExecutable('~/tools/codex', host).found, {
    path: '/Users/ana/tools/codex',
    origin: 'setting',
    kind: 'native',
  });
});

test(
  'on this machine: a real file needs run permission, and a #! file is a launcher',
  {
    skip: process.platform === 'win32',
  },
  async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'aw-find é '));
    const bin = path.join(folder, 'bin');
    await mkdir(bin);
    const file = path.join(bin, 'fake-cli');
    await writeFile(file, '#!/bin/sh\necho 1\n');
    await chmod(file, 0o644);
    const host = { ...defaultSearchHost(), env: { PATH: bin } };
    assert.equal(locateExecutable('fake-cli', host).found, undefined);
    assert.equal(locateExecutable('fake-cli', host).rejected[0]?.reason, 'notExecutable');
    await chmod(file, 0o755);
    assert.deepEqual(locateExecutable('fake-cli', host).found, {
      path: file,
      origin: 'path',
      kind: 'launcher',
    });
    await mkdir(path.join(bin, 'a-folder'));
    assert.equal(locateExecutable('a-folder', host).rejected[0]?.reason, 'folder');
  },
);
