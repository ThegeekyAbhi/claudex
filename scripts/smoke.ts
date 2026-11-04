import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { Agent, AgentEvent, Session } from '../src/model';
import { ClaudeAgent } from '../src/providers/claude';
import { CodexAgent } from '../src/providers/codex';

const root = await mkdtemp(path.join(tmpdir(), 'agent-workspace-smoke-'));
await writeFile(path.join(root, 'README.md'), '# Adapter smoke test\n');
for (const provider of ['codex', 'claude'] as const) {
  const session: Session = {
    id: randomUUID(),
    provider,
    title: 'Adapter smoke test',
    cwd: root,
    workspace: root,
    status: 'idle',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const receive = (event: AgentEvent) => {
    if (event.type === 'nativeId') session.nativeId = event.id;
    if (event.type === 'message') {
      console.log(provider, event.message.role, event.message.text.slice(0, 400));
    }
    if (event.type === 'delta') process.stdout.write('.');
    if (event.type === 'approval') {
      console.log(provider, 'approval (denied by test):', event.approval.title);
      event.respond(false, {});
    }
    if (event.type === 'status') {
      console.log('\n', provider, event.status);
      if (event.status === 'completed') finish?.();
      if (event.status === 'failed') fail?.(new Error(`${provider} failed`));
    }
  };
  function agent(): Agent {
    return provider === 'codex'
      ? new CodexAgent(session, process.env.CODEX_BIN ?? '/opt/homebrew/bin/codex', receive)
      : new ClaudeAgent(
          session,
          process.env.CLAUDE_BIN ?? path.join(homedir(), '.local/bin/claude'),
          receive,
        );
  }
  let current = agent();
  async function turn(prompt: string) {
    const completed = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const timeout = setTimeout(
      () => fail?.(new Error(`${provider} timed out after 90 seconds`)),
      90_000,
    );
    try {
      await Promise.all([current.send(prompt), completed]);
    } finally {
      clearTimeout(timeout);
    }
  }
  try {
    await turn('Reply with exactly WORKSPACE_OK. Do not call tools.');
    if (!session.nativeId) throw new Error('Provider did not return a session ID.');
    current.dispose();
    current = agent();
    await turn(
      'What exact marker did I ask you to reply with? Reply only with that marker, without using tools.',
    );
    console.log(provider, 'start + resume passed');
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    current.dispose();
  }
}
