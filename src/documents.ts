import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentEntry, Session } from './model';

export const documentFolder = 'docs/agent-work';
export type DocumentKind = 'plan' | 'task' | 'review' | 'handoff';
export async function resolveInside(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error('Expected a workspace-relative path.');
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(path.resolve(root, relative));
  const rel = path.relative(resolvedRoot, resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error('That path is outside this workspace.');
  return resolved;
}
export async function listDocuments(root: string): Promise<DocumentEntry[]> {
  root = await realpath(root);
  const result: DocumentEntry[] = [];
  async function visit(folder: string, depth: number): Promise<void> {
    if (depth > 4 || result.length >= 300) return;
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (entry.name.endsWith('.md') && result.length < 300)
        result.push({ path: path.relative(root, absolute), name: entry.name });
    }
  }
  try {
    const folder = await resolveInside(root, documentFolder);
    await visit(folder, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
export function template(kind: DocumentKind, title: string, session?: Session): string {
  const heading = `# ${title}\n\n`;
  const context = session ? `Session: ${session.id}\nProvider: ${session.provider}\n\n` : '';
  if (kind === 'handoff') {
    const transcript = (session?.messages ?? [])
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-12);
    return (
      heading +
      context +
      '## Goal\n\nDescribe the outcome to preserve.\n\n## Current state\n\nRecord completed work, open questions, and verification.\n\n## Next steps\n\n- [ ] Define the next concrete action.\n\n## Recent conversation\n\n' +
      transcript
        .map((message) => `### ${message.role === 'user' ? 'You' : 'Agent'}\n\n${message.text}\n`)
        .join('\n')
    );
  }
  if (kind === 'review')
    return (
      heading +
      context +
      '## Outcome\n\nDescribe the resulting behavior.\n\n## Findings\n\nRecord actionable findings with file references.\n\n## Verification\n\nList checks run and their results.\n\n## Remaining work\n\n- [ ] Record unresolved work.\n'
    );
  return (
    heading +
    context +
    '## Purpose\n\nDescribe the intended outcome.\n\n## Context\n\nLink relevant files, decisions, and constraints.\n\n## Work\n\n- [ ] Define a concrete step.\n\n## Dependencies\n\nRecord prerequisite work or write “None.”\n\n## Acceptance criteria\n\n- [ ] Describe observable success.\n\n## Verification\n\nRecord the checks needed to verify the outcome.\n'
  );
}
async function writeDocument(
  root: string,
  fallback: string,
  title: string,
  content: string,
): Promise<string> {
  // Validate each existing ancestor before creating directories; reject symlink escapes.
  for (const part of ['docs', documentFolder]) {
    try {
      await resolveInside(root, part);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(path.join(root, part));
    }
  }
  const folder = await resolveInside(root, documentFolder);
  await access(folder, constants.W_OK);
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || fallback;
  const relative = `${documentFolder}/${Date.now()}-${slug}.md`;
  await writeFile(path.join(root, relative), content, { flag: 'wx' });
  return relative;
}
export function createDocument(
  root: string,
  kind: DocumentKind,
  title: string,
  session?: Session,
): Promise<string> {
  return writeDocument(root, kind, title, template(kind, title, session));
}
/** Saves an agent's plan exactly as written: ordinary Markdown, nothing added but a title. */
export function savePlan(root: string, title: string, text: string): Promise<string> {
  const body = text.trimEnd();
  const content = /^#\s/m.test(body.split('\n')[0] ?? '') ? body : `# ${title}\n\n${body}`;
  return writeDocument(root, 'plan', `${title} plan`, `${content}\n`);
}
export async function readDocument(root: string, relative: string): Promise<string> {
  if (!relative.startsWith(`${documentFolder}/`) || !relative.endsWith('.md'))
    throw new Error('Only agent-work Markdown documents can be previewed.');
  return readFile(await resolveInside(root, relative), 'utf8');
}
