import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { JsonRpc } from '../../../src/providers/process';
import { runProvider } from '../../../src/providers/spawn';

const cwd = tmpdir();

test('RPC routes out-of-order results by ID and answers server requests', async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);if(m.method==='one')setTimeout(()=>console.log(JSON.stringify({id:m.id,result:'one'})),20);if(m.method==='two')console.log(JSON.stringify({id:m.id,result:'two'}));});`;
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', script],
    cwd,
    () => {},
    () => {},
  );
  try {
    assert.deepEqual(await Promise.all([rpc.request('one', {}), rpc.request('two', {})]), [
      'one',
      'two',
    ]);
  } finally {
    rpc.dispose();
  }
});
test('RPC rejects pending requests when the provider exits', async () => {
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', 'setTimeout(()=>process.exit(2),20)'],
    cwd,
    () => {},
    () => {},
  );
  await assert.rejects(() => rpc.request('unanswered', {}), /exited/);
  rpc.dispose();
});
test('missing executables fail without hanging promises', async () => {
  const rpc = new JsonRpc(
    '/missing/agent-workspace-cli',
    [],
    cwd,
    () => {},
    () => {},
  );
  await assert.rejects(() => rpc.request('initialize', {}), /ENOENT/);
  rpc.dispose();
});

test('RPC names the program in its exit error', async () => {
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', 'process.exit(3)'],
    cwd,
    () => {},
    () => {},
    undefined,
    { name: 'Codex' },
  );
  await assert.rejects(() => rpc.request('unanswered', {}), /^Error: Codex exited \(3\)/);
  rpc.dispose();
});
test('RPC keeps going past a non-JSON line on stdout', async () => {
  const script = `console.log('WARNING: something the CLI printed');const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);console.log(JSON.stringify({id:m.id,result:'ok'}));});`;
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', script],
    cwd,
    () => {},
    () => {},
  );
  try {
    assert.equal(await rpc.request('ping', {}), 'ok');
  } finally {
    rpc.dispose();
  }
});
test('RPC still fails on a broken JSON message', async () => {
  let closed: Error | undefined;
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', `console.log('{"id":1,');setInterval(()=>{},1000);`],
    cwd,
    () => {},
    (error) => {
      closed = error;
    },
  );
  await assert.rejects(() => rpc.request('ping', {}), /Invalid response/);
  assert.match(String(closed), /Invalid response/);
  rpc.dispose();
});
test('RPC refuses requests beyond its pending limit', async () => {
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    cwd,
    () => {},
    () => {},
    undefined,
    { maxPending: 1, timeoutMs: 5000 },
  );
  const first = rpc.request('one', {});
  await assert.rejects(() => rpc.request('two', {}), /too many unanswered/);
  rpc.dispose();
  await assert.rejects(() => first, /disconnected/);
});
test(
  'disposing stops the provider and the processes it started',
  { skip: process.platform === 'win32' },
  async () => {
    // The provider starts a grandchild that would outlive it, then reports the pid.
    const grand = "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)";
    const script = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:['ignore','pipe','ignore']});const ready=new Promise(r=>c.stdout.once('data',r));const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);ready.then(()=>console.log(JSON.stringify({id:m.id,result:c.pid})));});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    const rpc = new JsonRpc(
      process.execPath,
      ['-e', script],
      cwd,
      () => {},
      () => {},
    );
    const grandchild: number = await rpc.request('pid', {});
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    assert.ok(alive(grandchild));
    rpc.dispose();
    // Both ignore SIGTERM, so only the forced stop of the whole group after the grace period works.
    const deadline = Date.now() + 5000;
    while (alive(grandchild) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(grandchild), false);
  },
);
test('runProvider collects output and reports a nonzero exit', async () => {
  const ok = await runProvider(process.execPath, ['-e', 'console.log("1.2.3")'], { cwd });
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), '1.2.3');
  const bad = await runProvider(process.execPath, ['-e', 'console.error("no");process.exit(4)']);
  assert.equal(bad.code, 4);
  assert.match(bad.stderr, /no/);
});
test('runProvider passes extra environment and rejects a missing program', async () => {
  const env = await runProvider(
    process.execPath,
    ['-e', 'process.stdout.write(process.env.CODEX_HOME ?? "")'],
    { env: { CODEX_HOME: 'profile-home' } },
  );
  assert.equal(env.stdout, 'profile-home');
  await assert.rejects(() => runProvider('/missing/agent-workspace-cli', ['--version']), /ENOENT/);
});
test('runProvider gives up on a program that hangs', async () => {
  await assert.rejects(
    () => runProvider(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300 }),
    /did not finish in time/,
  );
});
