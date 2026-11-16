import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { listClaudeModels, listCodexModels } from '../../application/catalogs/model-catalog';
import { SkillCache } from '../../application/catalogs/skill-cache';
import {
  listClaudeSkills,
  listCodexSkills,
  setCodexSkillEnabled,
} from '../../application/catalogs/skill-catalog';
import type { Sessions } from '../../application/sessions/session-manager';
import { discoverSkillFiles } from '../../providers/skill-files';
import {
  type AgentKind,
  type AgentProfile,
  type AgentSetup,
  type Attachment,
  agentKind,
  agentTarget,
  allProfiles,
  CAPABILITIES,
  type Catalog,
  canRun,
  catalogFor,
  findProfile,
  type ModelOption,
  profileLabel,
  type Session,
  type Skill,
  type SkillCatalogs,
  sameSkill,
  type Thinking,
  thinkingSupport,
} from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { detectAgents, knownProfiles, launcherFor } from '../launcher';
import type { Surface, Surfaces } from '../surfaces';
import { ConfigurationHandlers } from './configuration';
import { GlobalSkillHandlers } from './global-skills';

type BorrowedSkill = Extract<Attachment, { kind: 'skill' }> & { path: string; from: AgentKind };

export interface CatalogHandlersContext {
  sessions: Pick<Sessions, 'sessions' | 'changed' | 'get' | 'setModel'>;
  output: Pick<vscode.OutputChannel, 'appendLine'>;
  scheduleUpdate(): void;
  cwd(surface?: Surface): string | undefined;
  surfaces: Pick<Surfaces, 'codeColumn'>;
}

/**
 * Models, agents and skill catalogs. Configuration inspection and Make global have their own
 * lifecycles and failure handling, so they live in their own classes; this one composes them.
 */
export class CatalogHandlers {
  catalog: Catalog = {};
  agents: AgentSetup = { profiles: [], problems: [], suggestions: [] };
  agentsLoad?: Promise<void>;
  catalogLoad?: Promise<void>;
  private skillCache = new SkillCache();
  private configuration: ConfigurationHandlers;
  private globalSkills: GlobalSkillHandlers;
  skillsVersion = 0;
  skillLoads = {
    clear: () => {
      this.skillCache.clear();
      this.configuration.cancelAll();
    },
  };
  catalogVersion = 0;
  constructor(private context: CatalogHandlersContext) {
    this.configuration = new ConfigurationHandlers({
      cwd: (surface) => context.cwd(surface),
      skillKey: (agent, cwd) => this.skillKey(agent, cwd),
    });
    this.globalSkills = new GlobalSkillHandlers({
      cwd: (surface) => context.cwd(surface),
      skillFiles: (agent, cwd) => this.skillFiles(agent, cwd),
      borrowedSkill: (item, cwd, scan) => this.borrowedSkill(item, cwd, scan),
      loadSkills: (agent, force, cwd) => this.loadSkills(agent, force, cwd),
    });
  }
  savedProfileIds(): string[] {
    return [...new Set(this.context.sessions.sessions.map(agentKind))];
  }
  /** Re-reads settings and checks each CLI. Models and skills follow, so they never lag behind. */
  loadAgents(): Promise<void> {
    this.skillLoads.clear();
    this.skillsVersion++;
    this.agents = {
      ...this.agents,
      profiles: this.agents.profiles.length
        ? this.agents.profiles
        : knownProfiles(this.savedProfileIds()),
    };
    const done = detectAgents(this.savedProfileIds())
      .then((agents) => {
        this.agents = agents;
        for (const problem of agents.problems)
          this.context.output.appendLine(`Profiles: ${problem}`);
        for (const profile of agents.profiles)
          if (profile.problem)
            this.context.output.appendLine(`${profile.label}: ${profile.problem}`);
      })
      .catch((error) => this.context.output.appendLine(`Agents: ${String(error)}`))
      .then(() => {
        this.catalogVersion++;
        this.context.scheduleUpdate();
      });
    this.agentsLoad = done;
    return done;
  }
  /** The profile a request names, if it exists and can run now. Webview input is checked here. */
  requireAgent(id: AgentKind): AgentProfile {
    const profile = findProfile(id);
    if (!profile) throw new Error(`There is no agent “${id}”. Add it as a profile to use it.`);
    if (!canRun(profile))
      throw new Error(`${profile.label} can’t run: ${profile.problem ?? 'it isn’t set up.'}`);
    return profile;
  }
  loadCatalog(force = false): Promise<void> {
    if (this.catalogLoad && !force) return this.catalogLoad;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    const list = (agent: AgentKind): Promise<ModelOption[]> => {
      const target = agentTarget(agent);
      const launcher = launcherFor(target.provider, target.profileId);
      return target.provider === 'codex'
        ? listCodexModels(launcher.executable, cwd, launcher.env)
        : listClaudeModels(launcher.executable, cwd, launcher.env);
    };
    // Only profiles that can run are asked, so a missing CLI never shows as a failed model list.
    this.catalogLoad = (this.agentsLoad ?? Promise.resolve())
      .then(() =>
        Promise.all(
          allProfiles().map(async (profile) => {
            const agent = profile.id;
            if (!canRun(profile)) {
              this.catalog[agent] = { status: 'error', models: [], error: profile.problem };
              return;
            }
            this.catalog[agent] = {
              status: 'loading',
              models: catalogFor(this.catalog, agent).models,
            };
            this.catalogVersion++;
            try {
              this.catalog[agent] = { status: 'ready', models: await list(agent) };
            } catch (error) {
              const text = error instanceof Error ? error.message : String(error);
              this.context.output.appendLine(`Models for ${profile.label}: ${text}`);
              this.catalog[agent] = { status: 'error', models: [], error: text };
            }
            this.catalogVersion++;
            this.context.scheduleUpdate();
          }),
        ),
      )
      .then(() => {
        this.catalogVersion++;
        this.context.scheduleUpdate();
      });
    return this.catalogLoad;
  }
  private skillKey(agent: AgentKind, cwd: string): string {
    const target = agentTarget(agent);
    const launcher = launcherFor(target.provider, target.profileId);
    return JSON.stringify([
      vscode.env.remoteName,
      agent,
      path.resolve(cwd),
      launcher.executable,
      findProfile(agent)?.version,
      launcher.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR,
      launcher.env?.CODEX_HOME ?? process.env.CODEX_HOME,
    ]);
  }
  skillsAt(cwd: string | undefined): SkillCatalogs {
    return Object.fromEntries(
      allProfiles().map((profile) => [
        profile.id,
        cwd
          ? { ...this.skillCache.get(this.skillKey(profile.id, cwd)), cwd }
          : {
              status: 'error',
              skills: [],
              problems: [],
              error: 'Open a file in the project you want to inspect, or select a thread.',
            },
      ]),
    );
  }
  loadSkills(
    agent: AgentKind,
    force = false,
    cwd = this.context.cwd(),
    native = false,
  ): Promise<void> {
    if (!cwd) return Promise.resolve();
    const profile = findProfile(agent);
    if (!profile) return Promise.resolve();
    const target = agentTarget(agent);
    const launcher = launcherFor(target.provider, target.profileId);
    return this.skillCache.load(
      this.skillKey(agent, cwd),
      force,
      (signal) => {
        if (!native) return this.skillFiles(agent, cwd, signal);
        this.requireAgent(agent);
        return target.provider === 'codex'
          ? listCodexSkills(launcher.executable, cwd, true, launcher.env, signal)
          : listClaudeSkills(launcher.executable, cwd, launcher.env, signal);
      },
      () => {
        this.skillsVersion++;
        this.context.scheduleUpdate();
      },
    );
  }
  /** A file scan of one profile's skill folders. Starts no CLI. */
  skillFiles(agent: AgentKind, cwd: string, signal?: AbortSignal) {
    const target = agentTarget(agent);
    const launcher = launcherFor(target.provider, target.profileId);
    return discoverSkillFiles({
      provider: target.provider,
      cwd,
      env: {
        CLAUDE_CONFIG_DIR: launcher.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR,
        CODEX_HOME: launcher.env?.CODEX_HOME ?? process.env.CODEX_HOME,
      },
      signal,
    });
  }
  /**
   * A skill borrowed from another account must be a file that account has right now, so the
   * webview can never name an arbitrary file to read. Checked on disk, without starting a CLI.
   */
  async borrowedSkill(
    item: Extract<Attachment, { kind: 'skill' }>,
    cwd: string,
    /** One scan of that account, when several of its skills are checked together. */
    scan?: (agent: AgentKind) => Promise<{ skills: Skill[] }>,
  ): Promise<BorrowedSkill> {
    const from = item.from ? findProfile(item.from) : undefined;
    if (!from || !item.path)
      throw new Error(`The skill “${item.name}” can’t be borrowed: its account is unknown.`);
    const { skills } = await (scan ? scan(from.id) : this.skillFiles(from.id, cwd));
    const skill = skills.find((found) => found.name === item.name && found.path === item.path);
    if (!skill?.path)
      throw new Error(`The skill “${item.name}” is no longer in ${from.label}’s skills.`);
    return { kind: 'skill', name: skill.name, path: skill.path, from: from.id };
  }
  /** Sending a turn authorizes native startup; passive browsing never does. */
  async checkSkills(
    agent: AgentKind,
    attachments: Attachment[] = [],
    cwd = this.context.cwd(),
  ): Promise<Attachment[]> {
    this.requireAgent(agent);
    if (!attachments.some((item) => item.kind === 'skill')) return attachments;
    if (!cwd) throw new Error('Choose a project before sending a skill.');
    const borrowed = new Map<Attachment, Attachment>();
    for (const item of attachments)
      if (item.kind === 'skill' && item.from)
        borrowed.set(item, await this.borrowedSkill(item, cwd));
    // Only this account's own skills need its native catalog.
    const native = attachments.some((item) => item.kind === 'skill' && !item.from);
    if (native) await this.loadSkills(agent, true, cwd, true);
    const catalog = this.skillsAt(cwd)[agent];
    if (native && catalog.status !== 'ready')
      throw new Error('Couldn’t verify selected skills with the native provider.');
    return attachments.map((item) => {
      if (item.kind !== 'skill') return item;
      const lent = borrowed.get(item);
      if (lent) return lent;
      const skill = catalog.skills.find(
        (skill) =>
          skill.enabled === true &&
          (agentTarget(agent).provider === 'claude'
            ? skill.name === item.name
            : sameSkill(skill, item)),
      );
      if (!skill)
        throw new Error(`The skill “${item.name}” isn’t available for ${profileLabel(agent)}.`);
      return { kind: 'skill', name: skill.name, ...(skill.path ? { path: skill.path } : {}) };
    });
  }
  modelOption(agent: AgentKind, model?: string | null): ModelOption | undefined {
    const models = catalogFor(this.catalog, agent).models;
    return model
      ? models.find((item) => item.id === model || item.resolvedModel === model)
      : models.find((item) => item.isDefault);
  }
  setThinking(session: Session, thinking: Thinking): void {
    if (session.observed || session.transition || ['running', 'waiting'].includes(session.status))
      throw new Error('Wait for this turn or stop it before changing thinking.');
    const model = this.modelOption(agentKind(session), session.model ?? session.activeModel);
    const support = thinkingSupport(session.provider, model);
    if ((thinking === 'on' && !support.on) || (thinking === 'off' && !support.off))
      throw new Error(support.reason || 'This thinking setting is unavailable.');
    session.thinking = thinking;
    session.adaptiveThinking = model?.adaptiveThinking === false ? false : undefined;
    if (
      session.provider === 'codex' &&
      thinking === 'on' &&
      (!session.effort || session.effort === 'none')
    )
      session.effort =
        model?.defaultEffort && model.defaultEffort !== 'none'
          ? model.defaultEffort
          : model?.efforts.find((effort) => effort !== 'none');
    this.context.sessions.changed();
  }
  /** Unsaved edits in an open editor count, since Build reads the file. */
  knownSkill(agent: AgentKind, name: string, file: string, cwd: string | undefined): Skill {
    const skill = this.skillsAt(cwd)[agent]?.skills.find(
      (item) => item.name === name && item.path === file,
    );
    if (!skill) throw new Error(`The skill “${name}” isn’t in ${profileLabel(agent)}’s list.`);
    return skill;
  }
  handlers(): HandlersFor<'catalog'> {
    return {
      ...this.configuration.handlers(),
      ...this.globalSkills.handlers(),
      setModel: async (action) => {
        const session = this.context.sessions.get(action.id);
        if (session.transition || ['running', 'waiting'].includes(session.status))
          throw new Error('Stop this turn before changing model or effort.');
        const option = this.modelOption(agentKind(session), action.model);
        if (action.effort && !option?.efforts.includes(action.effort))
          throw new Error('This model does not support that reasoning effort.');
        this.context.sessions.setModel(
          action.id,
          action.model,
          action.effort,
          option?.adaptiveThinking,
        );
        const support = thinkingSupport(session.provider, option);
        if (
          (session.thinking === 'off' && !support.off) ||
          (session.thinking === 'on' && !support.on)
        ) {
          session.thinking = 'default';
          session.messages.push({
            id: randomUUID(),
            role: 'notice',
            text: 'Thinking reset to Default because the new model does not support the previous choice.',
          });
        } else if (session.thinking) this.setThinking(session, session.thinking);
      },
      setThinking: async (action) => {
        this.setThinking(this.context.sessions.get(action.id), action.thinking);
      },
      refreshModels: async () => {
        void this.loadCatalog(true);
      },
      refreshSkills: async (action, surface) => {
        await this.loadSkills(action.agent, action.force, this.context.cwd(surface));
      },
      verifySkills: async (action, surface) => {
        const cwd = this.context.cwd(surface);
        if (!cwd)
          throw new Error('Open a file in the project you want to inspect, or select a thread.');
        this.requireAgent(action.agent);
        const key = this.skillKey(action.agent, cwd);
        const accepted = await vscode.window.showWarningMessage(
          `Verify ${profileLabel(action.agent)} skills in ${cwd}? Native startup can execute configured hooks and connect MCP servers. This does not verify an existing conversation.`,
          { modal: true },
          'Verify skills',
        );
        if (accepted !== 'Verify skills') return;
        if (
          !vscode.workspace.isTrusted ||
          this.context.cwd(surface) !== cwd ||
          this.skillKey(action.agent, cwd) !== key
        )
          throw new Error('The project or agent changed. Review native verification again.');
        await this.loadSkills(action.agent, true, cwd, true);
      },
      openSkill: async (action, surface) => {
        const skill = this.knownSkill(
          action.agent,
          action.name,
          action.path,
          this.context.cwd(surface),
        );
        if (skill.path)
          await vscode.window.showTextDocument(vscode.Uri.file(skill.path), {
            viewColumn: this.context.surfaces.codeColumn(),
          });
      },
      setSkillEnabled: async (action, surface) => {
        const cwd = this.context.cwd(surface);
        const skill = this.knownSkill(action.agent, action.name, action.path, cwd);
        const target = agentTarget(action.agent);
        const catalog = this.skillsAt(cwd)[action.agent];
        if (
          catalog.status !== 'ready' ||
          catalog.stale ||
          !CAPABILITIES[target.provider].skillToggle ||
          !skill.path ||
          skill.evidence !== 'native'
        )
          throw new Error(`${profileLabel(action.agent)} can’t turn skills on or off from here.`);
        this.requireAgent(action.agent);
        const launcher = launcherFor(target.provider, target.profileId);
        await setCodexSkillEnabled(
          launcher.executable,
          cwd ?? homedir(),
          skill.path,
          action.enabled,
          launcher.env,
        );
        await this.loadSkills(action.agent, true, cwd, true);
      },
    };
  }
}
