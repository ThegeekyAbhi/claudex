// Live acceptance test for agent-to-agent delegation. Consumes normal provider quota.
// Run only when live testing is authorized: pnpm smoke:delegate
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { Provider } from '../src/model';
import { createAgentFactory, Sessions } from '../src/sessions';

const CODEX = process.env.CODEX_BIN ?? '/opt/homebrew/bin/codex';
const CLAUDE = process.env.CLAUDE_BIN ?? path.join(homedir(), '.local/bin/claude');
const root = await mkdtemp(path.join(tmpdir(), 'agent-workspace-delegate-'));
await writeFile(path.join(root, 'README.md'), '# Delegation smoke test\n');

const manager = new Sessions(
  path.join(root, '.state'),
  createAgentFactory((provider) => (provider === 'codex' ? CODEX : CLAUDE)),
);
// Approves only the delegation itself; every other request is declined.
manager.on('change', () => {
  for (const session of manager.sessions) {
    const approval = session.approval;
    if (!approval) continue;
    const allowed = /^Run .* agent\?$/.test(approval.title);
    console.log(`  [${session.title}] ${allowed ? 'approved' : 'declined'}: ${approval.title}`);
    manager.approve(session.id, approval.id, allowed, {});
  }
});
async function scenario(lead: Provider, target: string, token: string) {
  console.log(`\n${lead} -> ${target}`);
  const session = manager.create(lead, root, root, `${lead} lead`);
  const finished = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${lead} timed out`)), 300_000);
    const check = () => {
      if (['completed', 'failed', 'interrupted'].includes(session.status)) {
        clearTimeout(timer);
        manager.off('change', check);
        resolve();
      }
    };
    manager.on('change', check);
  });
  await manager.send(
    session.id,
    `Use your run_agent tool with agent "${target}" and this exact prompt: "Reply with only the word ${token}. Do not use any tools." Then tell me what it replied.`,
  );
  await finished;
  const child = manager.sessions.find((item) => item.parentId === session.id && item.delegated);
  console.log('  lead status:', session.status, '| title:', session.title);
  console.log('  thinking blocks:', session.messages.filter((m) => m.role === 'thinking').length);
  console.log('  child:', child?.provider, child?.status, '| title:', child?.title);
  assert.equal(session.status, 'completed');
  assert.ok(child, 'a child thread should exist');
  assert.equal(child.status, 'completed');
  const reply = child.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? '';
  assert.match(reply, new RegExp(token));
  const leadReply = session.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? '';
  assert.match(leadReply, new RegExp(token), 'the lead should receive the real answer');
}
try {
  await scenario('claude', 'codex', 'PINEAPPLE');
  await scenario('codex', 'claude', 'MANGOSTEEN');
  console.log('\nDelegation smoke test passed in both directions.');
} finally {
  await manager.dispose();
}
