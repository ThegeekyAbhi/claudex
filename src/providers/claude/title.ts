import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export function claudeConfigDir(env?: Record<string, string>): string {
  return env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
}
/** Where Claude Code keeps a session's transcript: its folder for this cwd, or any other. */
export async function findClaudeTranscript(
  id: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<string | undefined> {
  const root = path.join(claudeConfigDir(env), 'projects');
  const name = `${id}.jsonl`;
  const expected = path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), name);
  if (await exists(expected)) return expected;
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const candidate = path.join(root, folder.name, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}
function exists(file: string): Promise<boolean> {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  );
}
/**
 * Reads the name Claude Code gave a session from its own transcript. A /rename wins over the
 * generated title, matching how the CLI lists sessions. Only transcripts are read here.
 */
export async function readClaudeTitle(
  id: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<string | undefined> {
  const file = await findClaudeTranscript(id, cwd, env);
  const content = file && (await readFile(file, 'utf8').catch(() => undefined));
  if (!content) return undefined;
  let ai: string | undefined;
  let custom: string | undefined;
  for (const line of content.split('\n')) {
    if (!line.includes('-title"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') ai = entry.aiTitle;
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string')
        custom = entry.customTitle;
    } catch {
      // A partial last line is expected while the CLI is still writing.
    }
  }
  return custom ?? ai;
}
