import { lstat, mkdir, readdir, readFile, realpath, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { copySkill, planSkillCopy, type SkillCopyPlan } from './skill-copy';

/**
 * The global skills folder: the Agent Skills standard's user folder. Codex reads it for every
 * Codex account; a Claude account reads a skill there through a link in its own skills folder,
 * since Claude Code only reads `<config dir>/skills`. Both CLIs document following such links.
 */
export function skillLibraryRoot(home = homedir()): string {
  return path.join(home, '.agents', 'skills');
}

export interface ClaudeSkillsFolder {
  id: string;
  label: string;
  /** That account's personal skills folder. */
  root: string;
}
export interface GlobalSkillPlan {
  name: string;
  /** Where the one shared copy lives, or will. */
  library: string;
  /** Set when the skill has to be copied into the library first. */
  copy?: SkillCopyPlan;
  /** Accounts that get a new link. */
  link: { id: string; label: string; entry: string }[];
  /** Accounts whose own identical copy goes to the Trash and becomes a link. */
  replace: { id: string; label: string; entry: string }[];
  /** Accounts left as they are: a different version, or a link to somewhere else. */
  keep: { id: string; label: string; entry: string; reason: string }[];
}

async function kind(file: string): Promise<'missing' | 'link' | 'directory' | 'other'> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) return 'link';
    return info.isDirectory() ? 'directory' : 'other';
  } catch {
    return 'missing';
  }
}

/** Same files with the same bytes. Links inside either folder count as a difference. */
export async function sameSkillFolder(a: string, b: string): Promise<boolean> {
  async function list(root: string, prefix = ''): Promise<string[]> {
    const names: string[] = [];
    for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.name === '.DS_Store') continue;
      if (entry.isDirectory()) names.push(...(await list(root, relative)));
      else if (entry.isFile()) names.push(relative);
      else return [`\0unsupported:${relative}`];
    }
    return names.sort();
  }
  const [left, right] = await Promise.all([list(a), list(b)]);
  if (left.length !== right.length || left.some((name, index) => name !== right[index]))
    return false;
  for (const name of left) {
    const [x, y] = await Promise.all([readFile(path.join(a, name)), readFile(path.join(b, name))]);
    if (!x.equals(y)) return false;
  }
  return true;
}

/** Works out what making a skill global would change. Writes nothing. */
export async function planGlobalSkill(
  skillFile: string,
  claude: ClaudeSkillsFolder[],
  home = homedir(),
): Promise<GlobalSkillPlan> {
  if (path.basename(skillFile) !== 'SKILL.md')
    throw new Error('Only folder skills with a SKILL.md can be made global.');
  const source = path.dirname(skillFile);
  const name = path.basename(source);
  const root = skillLibraryRoot(home);
  const rootReal = await realpath(root).catch(() => path.resolve(root));
  const sourceReal = await realpath(source);
  let library: string;
  let copy: SkillCopyPlan | undefined;
  if (path.dirname(sourceReal) === rootReal) library = sourceReal;
  else if (sourceReal.startsWith(`${rootReal}${path.sep}`))
    throw new Error('Skills nested deeper in the global folder can’t be linked from here.');
  else {
    library = path.join(root, name);
    const existing = await kind(library);
    if (existing === 'missing') copy = await planSkillCopy(skillFile, root);
    else if (existing !== 'directory' || !(await sameSkillFolder(source, library)))
      throw new Error(
        `A different “${name}” is already in ${root}. Nothing was changed; compare the two and keep one.`,
      );
  }
  const plan: GlobalSkillPlan = { name, library, copy, link: [], replace: [], keep: [] };
  for (const account of claude) {
    const entry = path.join(account.root, name);
    const found = await kind(entry);
    const item = { id: account.id, label: account.label, entry };
    if (found === 'missing') plan.link.push(item);
    else if (found === 'link') {
      const target = await realpath(entry).catch(() => undefined);
      if (target !== (await realpath(library).catch(() => library)))
        plan.keep.push({ ...item, reason: 'links to a different folder' });
    } else if (found === 'directory' && (await sameSkillFolder(entry, copy ? source : library)))
      plan.replace.push(item);
    else plan.keep.push({ ...item, reason: 'has its own, different version' });
  }
  return plan;
}

export interface GlobalSkillResult {
  linked: string[];
  skipped: { label: string; reason: string }[];
}

/**
 * Copies the skill into the library if needed, then links each account. A copy that's replaced
 * is checked again just before, and goes to the Trash through `trash`, never deleted outright.
 */
export async function applyGlobalSkill(
  plan: GlobalSkillPlan,
  trash: (folder: string) => Promise<void>,
): Promise<GlobalSkillResult> {
  if (plan.copy) await copySkill(plan.copy);
  const result: GlobalSkillResult = { linked: [], skipped: [] };
  for (const account of [...plan.replace, ...plan.link]) {
    const replacing = plan.replace.includes(account);
    const found = await kind(account.entry);
    if (replacing) {
      if (found !== 'directory' || !(await sameSkillFolder(account.entry, plan.library))) {
        result.skipped.push({ label: account.label, reason: 'its copy changed; left as it is' });
        continue;
      }
      await trash(account.entry);
    } else if (found !== 'missing') {
      result.skipped.push({ label: account.label, reason: 'a folder appeared; left as it is' });
      continue;
    }
    await mkdir(path.dirname(account.entry), { recursive: true });
    // A junction on Windows needs no extra rights; elsewhere the type is ignored.
    await symlink(plan.library, account.entry, 'junction');
    result.linked.push(account.label);
  }
  return result;
}

/** Whether a plan changes anything on disk. */
export function hasGlobalWork(plan: GlobalSkillPlan): boolean {
  return Boolean(plan.copy || plan.link.length || plan.replace.length);
}

/**
 * Where one skill ended up. Global means every Claude account links to the shared copy; an
 * account left with its own version, or skipped while applying, keeps it from being global.
 */
export interface GlobalSkillOutcome {
  name: string;
  state: 'alreadyGlobal' | 'done' | 'partial' | 'conflict' | 'failed';
  /** Accounts not linked, and why. */
  notes: string[];
}

/** Judges a skill from its plan and, when there was work, what applying it did. */
export function globalOutcome(
  plan: GlobalSkillPlan,
  applied?: GlobalSkillResult | Error,
): GlobalSkillOutcome {
  const kept = plan.keep.map((item) => `${item.label} ${item.reason}`);
  if (applied instanceof Error)
    return { name: plan.name, state: 'failed', notes: [applied.message, ...kept] };
  if (!hasGlobalWork(plan) || !applied)
    return { name: plan.name, state: kept.length ? 'conflict' : 'alreadyGlobal', notes: kept };
  const notes = [...kept, ...applied.skipped.map((item) => `${item.label}: ${item.reason}`)];
  return { name: plan.name, state: notes.length ? 'partial' : 'done', notes };
}

/** One message for a run: what is global now, and every skill or account that isn't. */
export function describeGlobalOutcomes(
  outcomes: GlobalSkillOutcome[],
  refused: string[] = [],
): { text: string; warning: boolean } {
  const count = (state: GlobalSkillOutcome['state']) =>
    outcomes.filter((item) => item.state === state);
  const done = count('done');
  const already = count('alreadyGlobal');
  const unfinished = outcomes.filter((item) => item.notes.length || item.state === 'failed');
  const parts = [
    done.length
      ? `${done.length === 1 ? `“${done[0]?.name}” is` : `${done.length} skills are`} now global. Found on disk; each agent confirms them on the next send or Verify.`
      : '',
    already.length
      ? `${already.length === 1 ? `“${already[0]?.name}” was` : `${already.length} skills were`} already global for every account.`
      : '',
    unfinished.length
      ? `Not global everywhere: ${unfinished
          .map(
            (item) =>
              `${item.name} (${item.state === 'failed' ? 'failed' : item.state === 'partial' ? 'partly linked' : 'unchanged'}: ${item.notes.join('; ')})`,
          )
          .join(', ')}.`
      : '',
    refused.length ? `Can’t make global: ${refused.join(', ')}.` : '',
  ].filter(Boolean);
  return {
    text: parts.join(' ') || 'Nothing was changed.',
    warning: unfinished.length > 0 || refused.length > 0,
  };
}
