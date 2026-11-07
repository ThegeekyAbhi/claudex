import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import {
  type Action,
  type AgentKind,
  type AgentProfile,
  type AgentSetup,
  agentKind,
  allProfiles,
  findProfile,
  type ProfileSetting,
  type Provider,
  profileIdFrom,
} from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { expandHome, HOME_ENV, launcherFor, profileHome } from '../launcher';
import type { Surface } from '../surfaces';

export interface ProfilesHandlersContext {
  loadAgents(): Promise<void>;
  loadCatalog(force?: boolean): Promise<void>;
  agents: AgentSetup;
  sessions: Pick<Sessions, 'sessions'>;
  skillLoads: Map<AgentKind, { at: number; done: Promise<void> }>;
}

export class ProfilesHandlers {
  private editing = false;
  private createdHomes = new Set<string>();
  private folders = new WeakMap<Surface, Map<string, string>>();
  private async profileRequest(
    action: Extract<Action, { type: 'profileRequest' }>,
    surface: Surface,
  ): Promise<void> {
    const reply = (result: {
      id?: string;
      folder?: string;
      token?: string;
      cancelled?: boolean;
      error?: string;
    }) =>
      surface.webview.postMessage({
        type: 'profileResult',
        requestId: action.requestId,
        ...result,
      });
    const request = action.request;
    if (this.editing) {
      await reply({ error: 'Another account change is still being saved. Try again.' });
      return;
    }
    this.editing = true;
    try {
      if (request.operation === 'pickFolder') {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          defaultUri: vscode.Uri.file(homedir()),
          openLabel: 'Use account folder',
        });
        if (!picked?.[0]) {
          await reply({ cancelled: true });
          return;
        }
        const token = randomUUID();
        const folders = this.folders.get(surface) ?? new Map<string, string>();
        folders.clear();
        folders.set(token, picked[0].fsPath);
        this.folders.set(surface, folders);
        await reply({ token, folder: picked[0].fsPath });
        return;
      }
      if (request.operation === 'create') {
        if (allProfiles().some((profile) => profile.id === request.id))
          throw new Error('That mention handle is already used.');
        let folder: string;
        if (request.folder.kind === 'new') folder = `~/.${request.provider}-${request.id}`;
        else if (request.folder.kind === 'suggested') {
          const suggestedPath = request.folder.path;
          const suggestion = this.context.agents.suggestions.find(
            (item) => item.path === suggestedPath && item.provider === request.provider,
          );
          if (!suggestion) throw new Error('That suggested folder is no longer available.');
          folder = suggestion.path;
        } else {
          const picked = this.folders.get(surface)?.get(request.folder.token);
          if (!picked) throw new Error('Choose the account folder again.');
          folder = picked;
        }
        if (
          allProfiles().some(
            (profile) =>
              profile.provider === request.provider && profileHome(profile) === expandHome(folder),
          )
        )
          throw new Error('Another profile already uses that folder.');
        if (request.folder.kind === 'new') {
          const home = expandHome(folder);
          if (!this.createdHomes.has(home)) {
            await mkdir(home);
            this.createdHomes.add(home);
          }
        } else if (!(await stat(expandHome(folder)).catch(() => undefined))?.isDirectory())
          throw new Error('Choose an existing account folder.');
        await this.writeProfiles((list) => [
          ...list,
          {
            id: request.id,
            name: request.name,
            provider: request.provider,
            configDir: folder,
            ...(request.executable ? { executable: request.executable } : {}),
          },
        ]);
        await reply({ id: request.id });
        return;
      }
      const profile = this.requireProfile(request.id);
      if (request.operation === 'rename') {
        if (profile.builtin) throw new Error('Built-in profiles keep their names.');
        await this.writeProfiles((list) =>
          profile.legacy
            ? [...list, settingFor(profile, request.name)]
            : list.map((item) => (item.id === profile.id ? { ...item, name: request.name } : item)),
        );
      } else if (request.operation === 'remove') {
        if (profile.builtin || profile.legacy)
          throw new Error('This profile cannot be removed here.');
        await this.writeProfiles((list) => list.filter((item) => item.id !== profile.id));
      } else {
        if (profile.status !== 'ready')
          throw new Error(profile.problem ?? 'Install the CLI and set up its folder first.');
        this.signIn(profile, false);
      }
      await reply({ id: profile.id });
    } catch (error) {
      await reply({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.editing = false;
    }
  }

  constructor(private context: ProfilesHandlersContext) {}
  requireProfile(id: string): AgentProfile {
    const profile = findProfile(id);
    if (!profile) throw new Error(`There is no agent profile “${id}”.`);
    return profile;
  }
  /** Edits `agentWorkspace.profiles` where it's set: the workspace's copy if it has one, else yours. */
  async writeProfiles(edit: (list: ProfileSetting[]) => ProfileSetting[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('agentWorkspace');
    const inspected = config.inspect<ProfileSetting[]>('profiles');
    const inWorkspace = Array.isArray(inspected?.workspaceValue);
    const current = (inWorkspace ? inspected?.workspaceValue : inspected?.globalValue) ?? [];
    await config.update(
      'profiles',
      edit(Array.isArray(current) ? current : []),
      inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
    );
    await this.context.loadAgents();
    if (vscode.workspace.isTrusted) void this.context.loadCatalog(true);
  }
  async addProfile(provider?: Provider, suggested?: string): Promise<void> {
    // A suggested folder must be one the host found, not any path a message names.
    const suggestion = suggested
      ? this.context.agents.suggestions.find((item) => item.path === suggested)
      : undefined;
    if (suggested && !suggestion) throw new Error('That folder is no longer suggested.');
    // Folders that look like another account come first, so an existing one is one pick away.
    if (!suggestion && !provider && this.context.agents.suggestions.length) {
      const picked = await vscode.window.showQuickPick(
        [
          ...this.context.agents.suggestions.map((item) => ({
            label: `Use ${item.path}`,
            description: item.provider === 'claude' ? 'Claude Code' : 'Codex',
            detail: 'Found in your home folder. Its sign-in, skills and history come with it.',
            item,
          })),
          { label: 'New Claude Code profile', item: undefined, provider: 'claude' as const },
          { label: 'New Codex profile', item: undefined, provider: 'codex' as const },
        ],
        { title: 'Add an agent profile' },
      );
      if (!picked) return;
      if (picked.item) return this.addProfile(undefined, picked.item.path);
      return this.addProfile('provider' in picked ? picked.provider : undefined);
    }
    const cli =
      suggestion?.provider ??
      provider ??
      (
        await vscode.window.showQuickPick(
          [
            { label: 'Claude Code', provider: 'claude' as const, detail: 'Uses CLAUDE_CONFIG_DIR' },
            { label: 'Codex', provider: 'codex' as const, detail: 'Uses CODEX_HOME' },
          ],
          { title: 'Add an agent profile: which CLI?' },
        )
      )?.provider;
    if (!cli) return;
    const cliName = cli === 'claude' ? 'Claude' : 'Codex';
    const taken = allProfiles().map((profile) => profile.id);
    const sameCli = allProfiles().filter((profile) => profile.provider === cli).length;
    const name = (
      await vscode.window.showInputBox({
        title: 'Profile name',
        prompt: 'Shown in the agent menu. You can rename it later.',
        value: suggestion
          ? `${cliName} ${path.basename(suggestion.path).replace(/^\.(claude|codex)[-_]?/, '') || sameCli + 1}`
          : `${cliName} ${sameCli + 1}`,
        validateInput: (value) => (value.trim() ? undefined : 'Enter a name.'),
      })
    )?.trim();
    if (!name) return;
    const id = (
      await vscode.window.showInputBox({
        title: 'Mention handle',
        prompt:
          'Type @handle to run this profile. It can’t be changed later without losing threads.',
        value: profileIdFrom(name, taken),
        validateInput: (value) =>
          !/^[a-z][a-z0-9-]{0,23}$/.test(value)
            ? 'Lowercase letters, digits and dashes, starting with a letter (24 at most).'
            : taken.includes(value)
              ? `@${value} is already used.`
              : undefined,
      })
    )?.trim();
    if (!id) return;
    let folder = suggestion?.path;
    let created = false;
    if (!folder) {
      const fresh = `~/.${cli === 'claude' ? 'claude' : 'codex'}-${id}`;
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: `Create ${fresh}`,
            detail:
              'An empty account. You sign in once, then add the skills and settings you want.',
            value: 'new',
          },
          { label: 'Choose an existing folder…', value: 'pick' },
        ],
        { title: `${HOME_ENV[cli]} for ${name}` },
      );
      if (!choice) return;
      if (choice.value === 'new') {
        if (existsSync(expandHome(fresh)))
          throw new Error(`${fresh} already exists. Choose it as an existing folder instead.`);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(expandHome(fresh)));
        folder = fresh;
        created = true;
      } else {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          defaultUri: vscode.Uri.file(homedir()),
          openLabel: `Use as ${HOME_ENV[cli]}`,
        });
        if (!picked?.[0]) return;
        const chosen = picked[0].fsPath;
        folder = chosen.startsWith(homedir() + path.sep)
          ? `~${chosen.slice(homedir().length)}`
          : chosen;
      }
    }
    const used = allProfiles().find(
      (profile) => profile.provider === cli && profileHome(profile) === expandHome(folder),
    );
    if (used) throw new Error(`${used.label} already uses ${folder}.`);
    await this.writeProfiles((list) => [...list, { id, name, provider: cli, configDir: folder }]);
    const action = await vscode.window.showInformationMessage(
      created
        ? `Added ${name}. Its folder is new, so sign in once. Its skills, plugins and MCP servers start empty.`
        : `Added ${name} (@${id}).`,
      ...(created ? ['Sign in'] : []),
    );
    const profile = findProfile(id);
    if (action === 'Sign in' && profile) this.signIn(profile);
  }
  async renameProfile(id: string): Promise<void> {
    const profile = this.requireProfile(id);
    if (profile.builtin)
      throw new Error(`${profile.label} is built in. Add a profile to name one yourself.`);
    const name = (
      await vscode.window.showInputBox({
        title: `Rename ${profile.label}`,
        prompt: `@${profile.id} stays the same, so its threads are kept.`,
        value: profile.label,
        validateInput: (value) => (value.trim() ? undefined : 'Enter a name.'),
      })
    )?.trim();
    if (!name || name === profile.label) return;
    await this.writeProfiles((list) =>
      profile.legacy
        ? [...list, settingFor(profile, name)]
        : list.map((item) => (item.id === id ? { ...item, name } : item)),
    );
  }
  async removeProfile(id: string): Promise<void> {
    const profile = this.requireProfile(id);
    if (profile.builtin) throw new Error(`${profile.label} is built in and can’t be removed.`);
    if (profile.legacy)
      throw new Error(
        `${profile.label} comes from a claud2 wrapper or the old claud2 settings, so there's nothing to remove here. Clear those to hide it.`,
      );
    const threads = this.context.sessions.sessions.filter(
      (session) => agentKind(session) === id,
    ).length;
    const answer = await vscode.window.showWarningMessage(
      `Remove ${profile.label}?`,
      {
        modal: true,
        detail:
          `Only the profile is removed. ${profile.homeDir ?? 'Its folder'} and everything in it are kept.` +
          (threads
            ? ` Its ${threads} ${threads === 1 ? 'thread stays' : 'threads stay'} listed but can’t continue until you add @${id} again.`
            : ''),
      },
      'Remove',
    );
    if (answer !== 'Remove') return;
    await this.writeProfiles((list) => list.filter((item) => item.id !== id));
  }
  /** Signing in happens in the CLI itself. Nothing here sees or stores a credential. */
  signIn(profile: AgentProfile, notify = true): void {
    const launcher = launcherFor(profile.provider, profile.id);
    const terminal = vscode.window.createTerminal({
      name: `Sign in · ${profile.label}`,
      cwd: homedir(),
      shellPath: launcher.executable,
      shellArgs: profile.provider === 'codex' ? ['login'] : [],
      ...(launcher.env ? { env: launcher.env } : {}),
    });
    terminal.show();
    if (notify && profile.provider === 'claude')
      void vscode.window.showInformationMessage(
        `Claude Code opened for ${profile.label}. Follow its sign-in, or type /login, then close the terminal.`,
      );
  }
  handlers(): HandlersFor<'profiles'> {
    return {
      profileRequest: (action, surface) => this.profileRequest(action, surface),
      refreshAgents: async () => {
        this.context.skillLoads.clear();
        await this.context.loadAgents();
        if (vscode.workspace.isTrusted) void this.context.loadCatalog(true);
      },
      addProfile: async (action) => {
        await this.addProfile(action.provider, action.folder);
      },
      saveProfile: async (action) => {
        const profile = this.requireProfile(action.id);
        if (!profile.legacy) return;
        await this.writeProfiles((list) => [...list, settingFor(profile, profile.label)]);
      },
      renameProfile: async (action) => {
        await this.renameProfile(action.id);
      },
      removeProfile: async (action) => {
        await this.removeProfile(action.id);
      },
      signInProfile: async (action) => {
        this.signIn(this.requireProfile(action.id));
      },
      openProfileFolder: async (action) => {
        const profile = this.requireProfile(action.id);
        const home = profileHome(profile);
        if (!existsSync(home)) throw new Error(`${home} doesn’t exist.`);
        const skills = path.join(home, 'skills');
        if (action.folder === 'skills' && !existsSync(skills))
          void vscode.window.showInformationMessage(
            `${profile.label} has no skills folder yet. Skills you add go in ${skills}.`,
          );
        const folder = action.folder === 'skills' && existsSync(skills) ? skills : home;
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
      },
    };
  }
}
/** A profile as a settings entry, keeping where it points. */
function settingFor(profile: AgentProfile, name: string): ProfileSetting {
  return {
    id: profile.id,
    name,
    provider: profile.provider,
    ...(profile.homeDir ? { configDir: profile.homeDir } : {}),
    ...(profile.executable ? { executable: profile.executable } : {}),
  };
}
