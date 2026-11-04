import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from './documents';
import {
  type Attachment,
  IMAGE_EXTENSION,
  IMAGE_FILE,
  type ImageInput,
  type Session,
  type SessionInput,
} from './model';
import { git } from './worktrees';

/** What this extension accepts from you. Generated images may be larger. */
export const MAX_ATTACHED_IMAGE = 10 * 1024 * 1024;
const MAX_STORED_IMAGE = 40 * 1024 * 1024;
const MAX_DIFF = 60_000;
const MAX_THREAD = 8_000;
const MAX_TERMINAL = 20_000;

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
/** Reads the file's real type, so a renamed file cannot pass as an image. */
export function sniffImage(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return undefined;
}
/** Images live in one folder of their own, the only user data the webview can load. */
export class ImageStore {
  constructor(readonly folder: string) {}
  async save(bytes: Uint8Array, limit = MAX_STORED_IMAGE): Promise<string> {
    if (bytes.length > limit)
      throw new Error(`Images can be at most ${Math.round(limit / 1024 / 1024)} MB.`);
    const type = sniffImage(bytes);
    if (!type) throw new Error('Only PNG, JPEG, GIF, and WebP images can be used.');
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const file = `${randomUUID()}.${type}`;
    await writeFile(path.join(this.folder, file), bytes, { mode: 0o600 });
    return file;
  }
  async copy(source: string, limit = MAX_STORED_IMAGE): Promise<string> {
    const info = await stat(source);
    if (info.size > limit)
      throw new Error(`Images can be at most ${Math.round(limit / 1024 / 1024)} MB.`);
    return this.save(await readFile(source), limit);
  }
  path(file: string): string {
    if (!IMAGE_FILE.test(file)) throw new Error('Unknown image.');
    return path.join(this.folder, file);
  }
  input(file: string): ImageInput {
    const extension = file.split('.').pop() ?? '';
    return { path: this.path(file), mediaType: MEDIA_TYPES[extension] ?? 'image/png' };
  }
}

/** Scores a subsequence match, favouring file names, word starts, and short paths. */
export function fuzzyScore(query: string, target: string): number | undefined {
  const needle = query.toLowerCase();
  const haystack = target.toLowerCase();
  const nameStart = haystack.lastIndexOf('/') + 1;
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return undefined;
    if (index === previous + 1) score += 6;
    if (index === nameStart || '/-_.'.includes(haystack[index - 1] ?? '/')) score += 4;
    if (index >= nameStart) score += 3;
    previous = index;
    from = index + 1;
  }
  if (haystack.slice(nameStart).startsWith(needle)) score += 12;
  return score - target.length / 40;
}
export interface ContextMatch {
  kind: 'file' | 'folder';
  path: string;
}
export function searchContext(files: string[], query: string, limit = 12): ContextMatch[] {
  const folders = new Set<string>();
  for (const file of files) {
    let end = file.lastIndexOf('/');
    while (end > 0) {
      const folder = file.slice(0, end);
      if (folders.has(folder)) break;
      folders.add(folder);
      end = folder.lastIndexOf('/');
    }
  }
  const scored: { match: ContextMatch; score: number }[] = [];
  for (const [kind, list] of [
    ['file', files],
    ['folder', [...folders]],
  ] as const)
    for (const item of list) {
      const score = query ? fuzzyScore(query, item) : -item.length / 40;
      if (score !== undefined) scored.push({ match: { kind, path: item }, score });
    }
  return scored
    .sort((a, b) => b.score - a.score || a.match.path.localeCompare(b.match.path))
    .slice(0, limit)
    .map((item) => item.match);
}
function capped(text: string, limit: number, what: string): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[Cut off here: this ${what} continues for another ${text.length - limit} characters.]`;
}
export async function branchDiff(cwd: string): Promise<{ base: string; diff: string }> {
  const remote = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(
    () => '',
  );
  const candidates = [remote.trim(), 'main', 'master', 'origin/main', 'origin/master'].filter(
    Boolean,
  );
  for (const base of candidates) {
    const known = await git(cwd, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).catch(
      () => '',
    );
    if (known) return { base, diff: await git(cwd, ['diff', `${base}...HEAD`]) };
  }
  throw new Error('Could not find a main branch to compare with.');
}
export interface ResolveOptions {
  /** Paths must stay inside this folder. */
  root: string;
  store: ImageStore;
  sessions: Session[];
  terminal?: (name: string) => string | undefined;
}
/**
 * Turns what you attached into what the agent receives. Files stay as paths so the agent reads
 * them under its own permissions; the transcript shows chips, never this block.
 */
export async function resolveAttachments(
  attachments: Attachment[],
  options: ResolveOptions,
): Promise<SessionInput> {
  const { root, store } = options;
  const lines: string[] = [];
  const paths: string[] = [];
  const images: ImageInput[] = [];
  const shown: Attachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === 'file' || attachment.kind === 'folder') {
      const target = await resolveInside(root, attachment.path);
      if (attachment.kind === 'file' && IMAGE_EXTENSION.test(attachment.path)) {
        const file = await store.copy(target, MAX_ATTACHED_IMAGE);
        images.push(store.input(file));
        shown.push({ kind: 'image', file, name: path.basename(attachment.path) });
        continue;
      }
      paths.push(attachment.kind === 'folder' ? `${attachment.path}/` : attachment.path);
      shown.push(attachment);
    } else if (attachment.kind === 'image') {
      images.push(store.input(attachment.file));
      shown.push(attachment);
    } else if (attachment.kind === 'thread') {
      const thread = options.sessions.find((item) => item.id === attachment.id);
      if (!thread) throw new Error('An attached thread no longer exists.');
      const last = thread.messages.filter((item) => item.role === 'assistant').at(-1)?.text;
      lines.push(
        `An earlier thread, "${thread.title}". Its last agent message:\n${capped(last ?? '(It has no agent message.)', MAX_THREAD, 'message')}`,
      );
      shown.push({ kind: 'thread', id: thread.id, title: thread.title });
    } else if (attachment.kind === 'diff') {
      const { base, diff } = await branchDiff(root);
      lines.push(
        diff.trim()
          ? `This branch compared with ${base}:\n\`\`\`diff\n${capped(diff, MAX_DIFF, 'diff')}\n\`\`\``
          : `This branch has no committed differences from ${base}.`,
      );
      shown.push(attachment);
    } else if (attachment.kind === 'terminal') {
      const output = options.terminal?.(attachment.name);
      if (output === undefined)
        throw new Error(`The terminal "${attachment.name}" has no output to attach.`);
      lines.push(
        `From the terminal "${attachment.name}":\n\`\`\`\n${capped(output, MAX_TERMINAL, 'output')}\n\`\`\``,
      );
      shown.push(attachment);
    }
  }
  if (paths.length)
    lines.unshift(
      `Paths the user attached, relative to the workspace. Read them as needed:\n${paths.map((item) => `- ${item}`).join('\n')}`,
    );
  return {
    ...(lines.length
      ? { context: `<attached_context>\n${lines.join('\n\n')}\n</attached_context>` }
      : {}),
    ...(images.length ? { images } : {}),
    ...(shown.length ? { attachments: shown } : {}),
  };
}
