import type { Skill, SkillSource } from '../shared/model';
import { JsonRpc } from './process';
import { mergeEnv } from './spawn';

export interface SkillList {
  skills: Skill[];
  problems: string[];
}
const WAIT_MS = 15_000;
function within<T>(work: Promise<T>, name: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${name} didn’t list its skills in time.`)),
        WAIT_MS,
      ).unref?.();
    }),
  ]);
}
/** Claude's own commands are marked builtin. Everything else is yours or a plugin's. */
export function parseClaudeCommands(commands: unknown): SkillList {
  const skills: Skill[] = [];
  for (const item of Array.isArray(commands) ? commands : []) {
    if (typeof item?.name !== 'string' || !item.name || item.builtin) continue;
    skills.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      ...(item.argumentHint ? { argumentHint: String(item.argumentHint) } : {}),
      enabled: true,
      evidence: 'native',
    });
  }
  return { skills, problems: [] };
}
const CODEX_SOURCES: Record<string, SkillSource> = {
  repo: 'project',
  user: 'personal',
  system: 'system',
  admin: 'admin',
};
export function parseCodexSkills(result: any): SkillList {
  const skills: Skill[] = [];
  const problems: string[] = [];
  for (const entry of Array.isArray(result?.data) ? result.data : []) {
    for (const item of Array.isArray(entry?.skills) ? entry.skills : []) {
      if (typeof item?.name !== 'string' || !item.name || typeof item?.path !== 'string') {
        problems.push('Codex returned a skill with no name or path.');
        continue;
      }
      const source = item.pluginId ? 'plugin' : CODEX_SOURCES[item.scope];
      skills.push({
        name: item.name,
        description: String(
          item.interface?.shortDescription ?? item.shortDescription ?? item.description ?? '',
        ),
        path: item.path,
        ...(source ? { source } : {}),
        enabled: item.enabled !== false,
        evidence: 'native',
      });
    }
    for (const error of Array.isArray(entry?.errors) ? entry.errors : [])
      problems.push(String(error?.message ?? error?.path ?? 'Codex couldn’t read a skill.'));
  }
  return { skills, problems };
}
/** Explicit native verification: startup can run hooks or connect configured servers. */
export async function listClaudeSkills(
  executable: string,
  cwd: string,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<SkillList> {
  signal?.throwIfAborted();
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  signal?.throwIfAborted();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const idle: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({
      next: () => held.then(() => ({ done: true as const, value: undefined })),
    }),
  };
  const active = query({
    prompt: idle,
    options: {
      cwd,
      pathToClaudeCodeExecutable: executable,
      settingSources: ['user', 'project', 'local'],
      ...(env ? { env: mergeEnv(env) } : {}),
    },
  });
  const abort = () => {
    release();
    active.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    return parseClaudeCommands(await within(active.supportedCommands(), 'Claude'));
  } finally {
    signal?.removeEventListener('abort', abort);
    release();
    active.close();
  }
}
async function withCodex<T>(
  executable: string,
  cwd: string,
  work: (rpc: JsonRpc) => Promise<T>,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const rpc = new JsonRpc(
    executable,
    ['app-server', '--listen', 'stdio://'],
    cwd,
    () => {},
    () => {},
    env,
    { name: 'Codex' },
  );
  const abort = () => rpc.dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    await rpc.request('initialize', {
      clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.6.0' },
      capabilities: { experimentalApi: false },
    });
    rpc.write({ method: 'initialized' });
    return await work(rpc);
  } finally {
    signal?.removeEventListener('abort', abort);
    rpc.dispose();
  }
}
export function listCodexSkills(
  executable: string,
  cwd: string,
  forceReload = false,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<SkillList> {
  return withCodex(
    executable,
    cwd,
    async (rpc) =>
      parseCodexSkills(
        await within(rpc.request('skills/list', { cwds: [cwd], forceReload }), 'Codex'),
      ),
    env,
    signal,
  );
}
export function setCodexSkillEnabled(
  executable: string,
  cwd: string,
  path: string,
  enabled: boolean,
  env?: Record<string, string>,
): Promise<void> {
  return withCodex(
    executable,
    cwd,
    async (rpc) => {
      await within(rpc.request('skills/config/write', { path, enabled }), 'Codex');
    },
    env,
  );
}
