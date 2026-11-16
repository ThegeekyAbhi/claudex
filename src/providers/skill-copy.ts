import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Provider } from '../shared/model';

/** Generous for instructions plus a few scripts and references; a skill bigger than this isn't copied. */
const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Where a profile's personal skills live. Codex reads `~/.agents/skills` for every profile, so a
 * skill copied there reaches all Codex profiles, not only the chosen one.
 */
export function personalSkillsRoot(
  provider: Provider,
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string {
  return provider === 'claude'
    ? path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), 'skills')
    : path.join(home, '.agents', 'skills');
}

export interface SkillCopyPlan {
  /** The skill's folder, holding SKILL.md. */
  source: string;
  /** The folder that will be created. It must not exist yet. */
  destination: string;
  files: number;
  bytes: number;
}

async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

/** Counts what would be copied. Links are refused, since they could point anywhere. */
async function measure(directory: string, total = { files: 0, bytes: 0 }) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const info = await lstat(file);
    if (info.isSymbolicLink())
      throw new Error(`The skill contains a link (${entry.name}), so it isn't copied.`);
    if (info.isDirectory()) await measure(file, total);
    else if (info.isFile()) {
      total.files++;
      total.bytes += info.size;
    } else throw new Error(`The skill contains an unsupported file (${entry.name}).`);
    if (total.files > MAX_FILES || total.bytes > MAX_BYTES)
      throw new Error('The skill is too large to copy from here. Copy its folder yourself.');
  }
  return total;
}

/** Checks a copy without writing anything. Only folder skills (`<name>/SKILL.md`) are copied. */
export async function planSkillCopy(skillFile: string, root: string): Promise<SkillCopyPlan> {
  if (path.basename(skillFile) !== 'SKILL.md')
    throw new Error(
      'Only folder skills with a SKILL.md can be copied. Commands stay where they are.',
    );
  const source = path.dirname(skillFile);
  const name = path.basename(source);
  if (!FOLDER_NAME.test(name)) throw new Error(`“${name}” isn’t a folder name that can be copied.`);
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory())
    throw new Error('The skill folder is a link, so it isn’t copied.');
  const destination = path.join(root, name);
  const resolvedRoot = path.resolve(root);
  if (path.dirname(path.resolve(destination)) !== resolvedRoot)
    throw new Error('The destination is outside the skills folder.');
  if (
    path.resolve(source) === path.resolve(destination) ||
    resolvedRoot.startsWith(`${path.resolve(source)}${path.sep}`)
  )
    throw new Error('The skill is already in that folder.');
  if (await exists(destination))
    throw new Error(`${destination} already exists. Nothing was copied or replaced.`);
  const { files, bytes } = await measure(source);
  return { source, destination, files, bytes };
}

/**
 * Copies into a temporary sibling, then renames it into place, so a failed copy never leaves a
 * half-written skill where the CLI would find it. Never replaces anything that exists.
 */
export async function copySkill(plan: SkillCopyPlan): Promise<void> {
  const root = path.dirname(plan.destination);
  await mkdir(root, { recursive: true });
  const staging = path.join(root, `.claudex-copy-${randomUUID()}`);
  try {
    await cp(plan.source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    // Measured again, in case the source changed after it was reviewed.
    const copied = await measure(staging);
    if (copied.files > MAX_FILES || copied.bytes > MAX_BYTES)
      throw new Error('The skill changed while it was being copied.');
    if (await exists(plan.destination))
      throw new Error(`${plan.destination} appeared while copying. Nothing was replaced.`);
    await rename(staging, plan.destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
