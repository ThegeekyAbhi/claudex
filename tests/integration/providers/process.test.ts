import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonRpc } from '../../../src/providers/process';

test('RPC routes out-of-order results by ID and answers server requests', async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);if(m.method==='one')setTimeout(()=>console.log(JSON.stringify({id:m.id,result:'one'})),20);if(m.method==='two')console.log(JSON.stringify({id:m.id,result:'two'}));});`;
  const rpc = new JsonRpc(
    process.execPath,
    ['-e', script],
    '/tmp',
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
    '/tmp',
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
    '/tmp',
    () => {},
    () => {},
  );
  await assert.rejects(() => rpc.request('initialize', {}), /ENOENT/);
  rpc.dispose();
});
