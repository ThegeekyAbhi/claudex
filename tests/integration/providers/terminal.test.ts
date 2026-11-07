import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readClaudeRecords, terminalArgs } from '../../../src/providers/terminal';
import { AGENT_MODES } from '../../../src/shared/model';

const base = { nativeId: 'abc', nativeSettings: { approvalPolicy: 'on-request' } };

test('Claude resumes in the same mode and on the same model', () => {
  const args = (mode?: (typeof AGENT_MODES)[number]) =>
    terminalArgs({ ...base, provider: 'claude', mode }).args;
  assert.deepEqual(args(), ['--resume', 'abc']);
  assert.deepEqual(args('auto'), ['--resume', 'abc', '--permission-mode', 'auto']);
  assert.deepEqual(args('plan'), ['--resume', 'abc', '--permission-mode', 'plan']);
  assert.deepEqual(args('ask').slice(-5), [
    'dontAsk',
    '--disallowedTools',
    'Edit',
    'Write',
    'NotebookEdit',
  ]);
  assert.deepEqual(
    terminalArgs({ ...base, provider: 'claude', model: 'opus', effort: 'high' }).args,
    ['--resume', 'abc', '--model', 'opus', '--effort', 'high'],
  );
});

test('Codex resumes in the same mode, and says when it cannot', () => {
  const run = (mode?: (typeof AGENT_MODES)[number], policy = 'on-request') =>
    terminalArgs({
      provider: 'codex',
      nativeId: 'abc',
      mode,
      nativeSettings: { approvalPolicy: policy },
    });
  assert.deepEqual(run().args, ['resume', 'abc']);
  assert.deepEqual(run('auto').args, ['resume', '-c', 'approvals_reviewer="auto_review"', 'abc']);
  assert.deepEqual(run('auto', 'never').args, ['resume', 'abc'], 'the same rule as a rich turn');
  assert.deepEqual(run('ask').args, ['resume', '-s', 'read-only', '-a', 'never', 'abc']);
  assert.deepEqual(run('plan').args, ['resume', 'abc']);
  assert.match(run('plan').note ?? '', /no flag/);
  assert.deepEqual(
    terminalArgs({ provider: 'codex', nativeId: 'abc', model: 'gpt', thinking: 'off' }).args,
    ['resume', '-m', 'gpt', '-c', 'model_reasoning_effort="none"', 'abc'],
  );
});

test('no mode ever opens a terminal with a bypass', () => {
  for (const provider of ['claude', 'codex'] as const)
    for (const mode of [undefined, ...AGENT_MODES]) {
      const text = terminalArgs({ ...base, provider, mode }).args.join(' ');
      assert.doesNotMatch(text, /bypass|dangerously|danger-full|yolo/);
    }
});

test('the Claude read uses its own process, so a second account stays contained', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aw-history-'));
  const sdk = path.join(root, 'sdk.mjs');
  await writeFile(
    sdk,
    `export async function getSessionMessages(id, { dir }) {
      if (id === 'none') return [];
      return [{ type: 'user', timestamp: 't', parent_tool_use_id: null, secret: 'x',
        message: { content: [id, dir, process.env.CLAUDE_CONFIG_DIR].join('|') } }];
    }`,
  );
  const before = process.env.CLAUDE_CONFIG_DIR;
  const [record] = (await readClaudeRecords(sdk, 'abc', root, {
    CLAUDE_CONFIG_DIR: '/two',
  })) as any[];
  assert.ok(record.message.content.startsWith('abc|'));
  assert.ok(record.message.content.endsWith('|/two'));
  assert.equal(record.secret, undefined, 'only the fields it needs');
  assert.equal(process.env.CLAUDE_CONFIG_DIR, before);
  await assert.rejects(readClaudeRecords(sdk, 'none', root), /no history/);
  await writeFile(sdk, 'throw new Error("broken");');
  await assert.rejects(readClaudeRecords(sdk, 'abc', root), /broken/);
});
