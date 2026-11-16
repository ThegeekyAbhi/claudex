import * as vscode from 'vscode';
import { personalSkillsRoot } from '../../providers/skill-copy';
import {
  applyGlobalSkill,
  describeGlobalOutcomes,
  type GlobalSkillOutcome,
  type GlobalSkillPlan,
  globalOutcome,
  hasGlobalWork,
  planGlobalSkill,
  skillLibraryRoot,
} from '../../providers/skill-library';
import {
  type AgentKind,
  type Attachment,
  agentTarget,
  allProfiles,
  type Skill,
} from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { launcherFor } from '../launcher';
import type { Surface } from '../surfaces';

export interface GlobalSkillsContext {
  cwd(surface?: Surface): string | undefined;
  skillFiles(agent: AgentKind, cwd: string): Promise<{ skills: Skill[] }>;
  borrowedSkill(
    item: Extract<Attachment, { kind: 'skill' }>,
    cwd: string,
    scan?: (agent: AgentKind) => Promise<{ skills: Skill[] }>,
  ): Promise<{ path: string }>;
  loadSkills(agent: AgentKind, force: boolean, cwd: string): Promise<void>;
}

/**
 * Make global: one shared copy in the skill library, linked into every Claude account. Each
 * skill is planned, confirmed, then applied and re-checked one at a time; the report comes from
 * what happened to each account, so a skill is called global only when every account has it.
 */
export class GlobalSkillHandlers {
  constructor(private context: GlobalSkillsContext) {}
  handlers(): Pick<HandlersFor<'catalog'>, 'makeSkillsGlobal'> {
    return {
      makeSkillsGlobal: async (action, surface) => {
        const cwd = this.context.cwd(surface);
        if (!cwd)
          throw new Error('Open a file in the project you want to inspect, or select a thread.');
        const { plans, refused } = await this.plan(action.skills, cwd);
        const work = plans.filter(hasGlobalWork);
        if (!work.length) {
          const report = describeGlobalOutcomes(
            plans.map((plan) => globalOutcome(plan)),
            refused,
          );
          if (report.warning) void vscode.window.showWarningMessage(report.text);
          else void vscode.window.showInformationMessage(report.text);
          return;
        }
        const accepted = await vscode.window.showWarningMessage(
          work.length === 1
            ? `Make “${work[0]?.name}” global?`
            : `Make ${work.length} skills global?`,
          { modal: true, detail: confirmation(work, refused).join('\n\n') },
          'Make global',
        );
        if (accepted !== 'Make global') return;
        if (!vscode.workspace.isTrusted)
          throw new Error('Trust this workspace to change skill folders.');
        const trash = (folder: string) =>
          Promise.resolve(
            vscode.workspace.fs.delete(vscode.Uri.file(folder), {
              recursive: true,
              useTrash: true,
            }),
          );
        // One at a time, each re-checked as it goes; a failure leaves the others as they are.
        const outcomes: GlobalSkillOutcome[] = [];
        for (const plan of plans) {
          if (!hasGlobalWork(plan)) {
            outcomes.push(globalOutcome(plan));
            continue;
          }
          try {
            outcomes.push(globalOutcome(plan, await applyGlobalSkill(plan, trash)));
          } catch (error) {
            outcomes.push(
              globalOutcome(plan, error instanceof Error ? error : new Error(String(error))),
            );
          }
        }
        for (const profile of allProfiles()) void this.context.loadSkills(profile.id, true, cwd);
        const report = describeGlobalOutcomes(outcomes, refused);
        if (report.warning) void vscode.window.showWarningMessage(report.text);
        else void vscode.window.showInformationMessage(report.text);
      },
    };
  }
  /** Works out every selected skill without changing anything; the ones that can't go say why. */
  private async plan(
    skills: { agent: AgentKind; name: string; path: string }[],
    cwd: string,
  ): Promise<{ plans: GlobalSkillPlan[]; refused: string[] }> {
    const claude = allProfiles()
      .filter((profile) => profile.provider === 'claude')
      .map((profile) => {
        const launcher = launcherFor('claude', agentTarget(profile.id).profileId);
        const root = personalSkillsRoot('claude', {
          CLAUDE_CONFIG_DIR: launcher.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR,
        });
        return { id: profile.id, label: profile.label, root };
      });
    const plans: GlobalSkillPlan[] = [];
    const refused: string[] = [];
    const names = new Set<string>();
    const scans = new Map<AgentKind, Promise<{ skills: Skill[] }>>();
    const scan = (agent: AgentKind) => {
      const known = scans.get(agent) ?? this.context.skillFiles(agent, cwd);
      scans.set(agent, known);
      return known;
    };
    for (const item of skills) {
      try {
        // Each must be a file its account has on disk right now.
        const owned = await this.context.borrowedSkill(
          { kind: 'skill', name: item.name, path: item.path, from: item.agent },
          cwd,
          scan,
        );
        const plan = await planGlobalSkill(owned.path, claude);
        // Two selected skills sharing a folder name would compete for one library folder.
        if (names.has(plan.name)) throw new Error(`Another selected skill is also “${plan.name}”.`);
        names.add(plan.name);
        plans.push(plan);
      } catch (error) {
        refused.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { plans, refused };
  }
}

/** The modal's detail: every change, and everything that will be left alone. */
function confirmation(work: GlobalSkillPlan[], refused: string[]): string[] {
  const copies = work.filter((plan) => plan.copy);
  const linked = [...new Set(work.flatMap((plan) => plan.link.map((item) => item.label)))];
  const replaced = work.flatMap((plan) => plan.replace);
  const kept = work.flatMap((plan) =>
    plan.keep.map((item) => `${plan.name} in ${item.label} (${item.reason})`),
  );
  return [
    `${copies.length ? `Moves ${copies.length} into` : 'Uses the shared copies in'} ${skillLibraryRoot()}. Every Codex account reads this folder.`,
    linked.length ? `Links them into: ${linked.join(', ')}.` : '',
    replaced.length
      ? `Replaces ${replaced.length} identical ${replaced.length === 1 ? 'copy' : 'copies'} with links; each copy goes to the Trash.`
      : '',
    kept.length ? `Leaves alone: ${listed(kept)}` : '',
    refused.length ? `Can’t make global: ${listed(refused)}` : '',
    'After this, editing a skill once changes it for every account. Scripts are not run. A running conversation may need a new session to see changes.',
  ].filter(Boolean);
}

/** A short list for a dialog: the first few, then how many more. */
function listed(items: string[], shown = 8): string {
  const head = items.slice(0, shown).join('; ');
  return items.length > shown ? `${head}; and ${items.length - shown} more.` : `${head}.`;
}
