import { constants, type Dir } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Provider, Skill, SkillSource } from '../shared/model';

export interface SkillFilesOptions {
  provider: Provider;
  cwd: string;
  env?: Record<string, string | undefined>;
  home?: string;
  signal?: AbortSignal;
}
export interface SkillFilesResult {
  skills: Skill[];
  problems: string[];
}
interface Root {
  directory: string;
  source: SkillSource;
  commands?: boolean;
}
const MAX_FILE_BYTES = 64 * 1024;
const MAX_ENTRIES = 2000;

function scalar(value: string): string {
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error('Invalid quoted value');
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[!&*[{]/.test(value)) throw new Error('Unsupported metadata');
  return value.replace(/\s+#.*$/, '').trim();
}

/** A deliberately small, inert frontmatter reader. Unsupported metadata stays unverified. */
export function skillFileMetadata(text: string, fallback: string, provider: Provider) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('Missing frontmatter');
  const fields = new Map<string, string>();
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const item = /^(name|description|argument-hint):\s*(.*)$/.exec(lines[i]);
    if (!item) continue;
    if (fields.has(item[1])) throw new Error('Duplicate metadata');
    let value = item[2];
    if (/^[>|][-+]?\s*$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s|$)/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(' ').trim();
    } else value = scalar(value);
    if (typeof value !== 'string') throw new Error('Invalid metadata type');
    fields.set(item[1], value);
  }
  const name = fields.get('name') ?? (provider === 'claude' ? fallback : '');
  const description = fields.get('description') ?? '';
  if (
    !name ||
    name.length > 200 ||
    /[\s<>]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('Invalid name');
  if (!description || description.length > 4096) throw new Error('Invalid description');
  return { name, description, argumentHint: fields.get('argument-hint') };
}

async function roots(options: SkillFilesOptions): Promise<Root[]> {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const result: Root[] = [];
  let cwd = path.resolve(options.cwd);
  for (let depth = 0; depth < 64; depth++) {
    options.signal?.throwIfAborted();
    result.push({
      directory: path.join(cwd, options.provider === 'claude' ? '.claude' : '.agents', 'skills'),
      source: 'project',
    });
    if (options.provider === 'claude')
      result.push({
        directory: path.join(cwd, '.claude', 'commands'),
        source: 'project',
        commands: true,
      });
    if (
      await lstat(path.join(cwd, '.git')).then(
        () => true,
        () => false,
      )
    )
      break;
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  const nativeHome =
    options.provider === 'claude'
      ? (env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'))
      : (env.CODEX_HOME ?? path.join(home, '.codex'));
  if (options.provider === 'claude') {
    result.push({ directory: path.join(nativeHome, 'skills'), source: 'personal' });
    result.push({
      directory: path.join(nativeHome, 'commands'),
      source: 'personal',
      commands: true,
    });
  } else {
    result.push({ directory: path.join(home, '.agents', 'skills'), source: 'personal' });
    result.push({ directory: path.join(nativeHome, 'skills'), source: 'personal' });
    result.push({ directory: path.join(nativeHome, 'skills', '.system'), source: 'system' });
    if (process.platform !== 'win32')
      result.push({ directory: '/etc/codex/skills', source: 'admin' });
  }
  return result;
}

/** Reads only bounded Markdown metadata. Never starts a provider, loads settings or runs scripts. */
export async function discoverSkillFiles(options: SkillFilesOptions): Promise<SkillFilesResult> {
  const result: SkillFilesResult = { skills: [], problems: [] };
  const visited = new Set<string>();
  const files = new Set<string>();
  let remaining = MAX_ENTRIES;
  const library = await realpath(path.join(options.home ?? homedir(), '.agents', 'skills')).catch(
    () => undefined,
  );
  async function read(file: string, fallback: string, root: Root) {
    options.signal?.throwIfAborted();
    try {
      // Reject devices/FIFOs before opening, then verify the opened handle as well.
      const target = await realpath(file);
      if (files.has(target)) return;
      const info = await lstat(target);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Invalid file');
      const handle = await open(
        target,
        constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > MAX_FILE_BYTES) throw new Error('Invalid file');
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_FILE_BYTES) throw new Error('File too large');
        const text = buffer.toString('utf8', 0, bytesRead);
        const metadata =
          root.commands && !/^\uFEFF?---\r?\n/.test(text)
            ? { name: fallback, description: 'Legacy command; native verification required.' }
            : skillFileMetadata(text, fallback, options.provider);
        result.skills.push({
          ...metadata,
          path: file,
          source: root.source,
          enabled: null,
          evidence: 'disk',
          ...(library && target.startsWith(`${library}${path.sep}`) ? { global: true } : {}),
        });
        files.add(target);
      } finally {
        await handle.close();
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        result.problems.push(
          `Couldn’t inspect ${file}. Metadata may be unsupported, unreadable or too large.`,
        );
    }
  }
  async function scan(root: Root, depth = 0, prefix = ''): Promise<void> {
    options.signal?.throwIfAborted();
    let directory: Dir;
    try {
      const canonical = await realpath(root.directory);
      if (visited.has(canonical)) return;
      visited.add(canonical);
      directory = await opendir(root.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        result.problems.push(`Couldn’t inspect ${root.directory}.`);
      return;
    }
    for await (const entry of directory) {
      options.signal?.throwIfAborted();
      if (--remaining < 0) break;
      if (entry.name.startsWith('.')) continue;
      const file = path.join(root.directory, entry.name);
      if (root.commands) {
        if (entry.isDirectory() && depth < 3)
          await scan({ ...root, directory: file }, depth + 1, `${prefix}${entry.name}:`);
        else if (entry.isFile() && entry.name.endsWith('.md'))
          await read(file, `${prefix}${entry.name.slice(0, -3)}`, root);
      } else if (entry.isDirectory() || entry.isSymbolicLink())
        await read(path.join(file, 'SKILL.md'), entry.name, root);
    }
  }
  for (const root of await roots(options)) {
    if (remaining < 0) break;
    await scan(root);
  }
  if (remaining < 0) result.problems.push('Skill scan limit reached. The inventory is incomplete.');
  const names = new Set<string>();
  for (const skill of result.skills) {
    if (names.has(skill.name))
      result.problems.push(
        `Multiple files declare ${skill.name}. Verify with the agent to resolve native availability.`,
      );
    names.add(skill.name);
  }
  result.skills.sort(
    (a, b) => a.name.localeCompare(b.name) || (a.path ?? '').localeCompare(b.path ?? ''),
  );
  return result;
}
