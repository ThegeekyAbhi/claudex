import assert from 'node:assert/strict';
import test from 'node:test';
import { launchSpec, mergeEnv, quoteCmdArg, taskkillPath } from '../../../src/providers/spawn';

test('mergeEnv replaces a Windows variable whose name differs only in case', () => {
  const merged = mergeEnv(
    { PATH: 'C:\\new', CODEX_HOME: 'C:\\h' },
    { Path: 'C:\\old', x: '1' },
    'win32',
  );
  assert.deepEqual(merged, { x: '1', PATH: 'C:\\new', CODEX_HOME: 'C:\\h' });
});

test('mergeEnv keeps case-distinct names apart on macOS and Linux', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const merged = mergeEnv({ PATH: '/new' }, { Path: '/old' }, platform);
    assert.deepEqual(merged, { Path: '/old', PATH: '/new' });
  }
});

test('mergeEnv without extras copies the base and leaves it unchanged', () => {
  const base = { A: '1' };
  const merged = mergeEnv(undefined, base, 'win32');
  assert.deepEqual(merged, base);
  assert.notEqual(merged, base);
});

test('a native executable starts directly with its arguments untouched, on every OS', () => {
  const args = ['app-server', '--listen', 'stdio://', 'a b', 'x"y', '%PATH%'];
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const exe = platform === 'win32' ? 'C:\\Program Files\\Codex\\codex.exe' : '/usr/bin/codex';
    assert.deepEqual(launchSpec(exe, args, platform), { command: exe, args });
  }
});

test('a .cmd launcher on macOS/Linux is not treated specially', () => {
  assert.deepEqual(launchSpec('/x/codex.cmd', ['a'], 'linux'), {
    command: '/x/codex.cmd',
    args: ['a'],
  });
});

test('a Windows .cmd/.bat launcher goes through cmd.exe with quoted arguments, never shell', () => {
  for (const exe of ['C:\\npm\\codex.cmd', 'C:\\npm\\CODEX.BAT']) {
    const spec = launchSpec(exe, ['app-server', 'a b'], 'win32', 'C:\\Windows\\cmd.exe');
    assert.equal(spec.command, 'C:\\Windows\\cmd.exe');
    assert.equal(spec.windowsVerbatimArguments, true);
    assert.deepEqual(spec.args.slice(0, 3), ['/d', '/s', '/c']);
    const line = spec.args[3] ?? '';
    assert.ok(line.startsWith('"') && line.endsWith('"'));
    assert.ok(line.includes(quoteCmdArg('a b')));
  }
});

test('cmd quoting escapes metacharacters, quotes and backslashes', () => {
  // Plain text is quoted and the quotes are caret-escaped twice for a forwarding launcher.
  assert.equal(quoteCmdArg('abc', false), '^"abc^"');
  assert.equal(quoteCmdArg('abc'), '^^^"abc^^^"');
  // Spaces, ampersands, pipes and percent signs can't reach cmd unescaped.
  const risky = quoteCmdArg('a & b | c %PATH% <x> "q"', false);
  for (const meta of ['&', '|', '%', '<', '>'])
    for (const [index, char] of [...risky].entries())
      if (char === meta) assert.equal(risky[index - 1], '^', `${meta} escaped in ${risky}`);
  // A quote inside is backslash-escaped for the C runtime; trailing backslashes are doubled.
  assert.equal(quoteCmdArg('x"y', false), '^"x\\^"y^"');
  assert.equal(quoteCmdArg('C:\\dir\\', false), '^"C:\\dir\\\\^"');
});

test('the launcher path itself has its metacharacters escaped', () => {
  const spec = launchSpec('C:\\a&b\\codex.cmd', [], 'win32', 'cmd.exe');
  assert.ok(spec.args[3]?.includes('C:\\a^&b\\codex.cmd'));
});

test('a Windows command script refuses arguments cmd.exe would cut off', () => {
  for (const arg of ['a\nb', 'a\r\nb', 'a\rb', 'a\0b'])
    assert.throws(
      () => launchSpec('C:\\npm\\codex.cmd', ['ok', arg], 'win32', 'cmd.exe'),
      /can't receive an argument containing a line break/,
    );
});

test('line breaks still pass to native programs, which receive them intact', () => {
  assert.deepEqual(launchSpec('C:\\codex.exe', ['a\nb'], 'win32'), {
    command: 'C:\\codex.exe',
    args: ['a\nb'],
  });
  assert.deepEqual(launchSpec('/usr/bin/codex', ['a\nb'], 'linux').args, ['a\nb']);
});

test("taskkill is Windows' own, by full path, whatever the PATH holds", () => {
  assert.equal(taskkillPath({ SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\taskkill.exe');
  assert.equal(taskkillPath({ windir: 'E:\\W' }), 'E:\\W\\System32\\taskkill.exe');
  assert.equal(taskkillPath({ PATH: 'C:\\evil' }), 'C:\\Windows\\System32\\taskkill.exe');
});
