import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { listClaudeModels, listCodexModels } from '../../application/catalogs/model-catalog';
import {
  listClaudeSkills,
  listCodexSkills,
  setCodexSkillEnabled,
} from '../../application/catalogs/skill-catalog';
import type { Sessions } from '../../application/sessions/session-manager';
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
  emptySkills,
  findProfile,
  type ModelOption,
  profileLabel,
  type Session,
  type Skill,
  type SkillCatalogs,
  sameSkill,
  skillsFor,
  type Thinking,
  thinkingSupport,
} from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { detectAgents, knownProfiles, launcherFor } from '../launcher';
import type { Surfaces } from '../surfaces';

export interface CatalogHandlersContext {
  sessions: Pick<Sessions, 'sessions' | 'changed' | 'get' | 'setModel'>;
  output: Pick<vscode.OutputChannel, 'appendLine'>;
  scheduleUpdate(): void;
  surfaces: Pick<Surfaces, 'codeColumn'>;
}

export class CatalogHandlers {
  catalog: Catalog = {};
  agents: AgentSetup = { profiles: [], problems: [], suggestions: [] };
  agentsLoad?: Promise<void>;
  catalogLoad?: Promise<void>;
  skills: SkillCatalogs = structuredClone(emptySkills);
  skillsVersion = 0;
  skillLoads = new Map<AgentKind, { at: number; done: Promise<void> }>();
  catalogVersion = 0;
  constructor(private context: CatalogHandlersContext) {}
  savedProfileIds(): string[] {
    return [...new Set(this.context.sessions.sessions.map(agentKind))];
  }
  /** Re-reads settings and checks each CLI. Models and skills follow, so they never lag behind. */
  loadAgents(): Promise<void> {
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
  /** Runs in the background, and at most every 30 s, so opening a menu never waits on a CLI. */
  loadSkills(agent: AgentKind, force = false): Promise<void> {
    const recent = this.skillLoads.get(agent);
    if (recent && !force && Date.now() - recent.at < 30_000) return recent.done;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    const profile = findProfile(agent);
    if (!profile || !canRun(profile)) return Promise.resolve();
    const target = agentTarget(agent);
    const launcher = launcherFor(target.provider, target.profileId);
    const previous = skillsFor(this.skills, agent);
    this.skills[agent] = { ...previous, status: previous.skills.length ? 'ready' : 'loading' };
    this.skillsVersion++;
    const done = (
      target.provider === 'codex'
        ? listCodexSkills(launcher.executable, cwd, force, launcher.env)
        : listClaudeSkills(launcher.executable, cwd, launcher.env)
    )
      .then((list) => {
        this.skills[agent] = { status: 'ready', ...list };
      })
      .catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        this.context.output.appendLine(`Skills for ${profile.label}: ${text}`);
        this.skills[agent] = { status: 'error', skills: [], problems: [], error: text };
      })
      .then(() => {
        this.skillsVersion++;
        this.context.scheduleUpdate();
      });
    this.skillLoads.set(agent, { at: Date.now(), done });
    this.context.scheduleUpdate();
    return done;
  }
  /** Skills come back from the webview, so each is checked against what the CLI really listed. */
  async checkSkills(agent: AgentKind, attachments: Attachment[] = []): Promise<Attachment[]> {
    this.requireAgent(agent);
    if (!attachments.some((item) => item.kind === 'skill')) return attachments;
    if (skillsFor(this.skills, agent).status !== 'ready') await this.loadSkills(agent);
    for (const item of attachments) {
      if (item.kind !== 'skill') continue;
      if (
        !skillsFor(this.skills, agent).skills.some(
          (skill) => skill.enabled && sameSkill(skill, item),
        )
      )
        throw new Error(`The skill “${item.name}” isn’t available for ${profileLabel(agent)}.`);
    }
    return attachments;
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
  knownSkill(agent: AgentKind, name: string, file: string): Skill {
    const skill = skillsFor(this.skills, agent).skills.find(
      (item) => item.name === name && item.path === file,
    );
    if (!skill) throw new Error(`The skill “${name}” isn’t in ${profileLabel(agent)}’s list.`);
    return skill;
  }
  handlers(): HandlersFor<'catalog'> {
    return {
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
      refreshSkills: async (action) => {
        void this.loadSkills(action.agent);
      },
      openSkill: async (action) => {
        const skill = this.knownSkill(action.agent, action.name, action.path);
        if (skill.path)
          await vscode.window.showTextDocument(vscode.Uri.file(skill.path), {
            viewColumn: this.context.surfaces.codeColumn(),
          });
      },
      setSkillEnabled: async (action) => {
        const skill = this.knownSkill(action.agent, action.name, action.path);
        const target = agentTarget(action.agent);
        if (!CAPABILITIES[target.provider].skillToggle || !skill.path)
          throw new Error(`${profileLabel(action.agent)} can’t turn skills on or off from here.`);
        this.requireAgent(action.agent);
        const launcher = launcherFor(target.provider, target.profileId);
        await setCodexSkillEnabled(
          launcher.executable,
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
          skill.path,
          action.enabled,
          launcher.env,
        );
        await this.loadSkills(action.agent, true);
      },
    };
  }
}
