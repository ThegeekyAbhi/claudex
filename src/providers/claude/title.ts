import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export function claudeConfigDir(env?: Record<string, string>): string {
  return env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
}
async function transcriptText(root: string, id: string, cwd: string): Promise<string | undefined> {
  const name = `${id}.jsonl`;
  const expected = path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), name);
  const direct = await readFile(expected, 'utf8').catch(() => undefined);
  if (direct !== undefined) return direct;
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const found = await readFile(path.join(root, folder.name, name), 'utf8').catch(() => undefined);
    if (found !== undefined) return found;
  }
  return undefined;
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
  const content = await transcriptText(path.join(claudeConfigDir(env), 'projects'), id, cwd);
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
