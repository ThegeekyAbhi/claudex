import * as vscode from 'vscode';
import { inspectConfiguration } from '../../providers/configuration/inspect';
import { type AgentKind, agentTarget, findProfile } from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { launcherFor } from '../launcher';
import type { Surface } from '../surfaces';

export interface ConfigurationHandlersContext {
  cwd(surface?: Surface): string | undefined;
  /** Changes when anything that decides an agent's configuration does. */
  skillKey(agent: AgentKind, cwd: string): string;
}

/**
 * Passive reads of each agent's configuration files. One load per view at a time: a newer
 * request, a changed project, or a settings reload cancels the older one, which then posts
 * nothing, so a view never shows another project's configuration.
 */
export class ConfigurationHandlers {
  private loads = new WeakMap<Surface, AbortController>();
  private controllers = new Set<AbortController>();
  constructor(private context: ConfigurationHandlersContext) {}
  cancelAll(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  handlers(): Pick<HandlersFor<'catalog'>, 'inspectConfiguration'> {
    return {
      inspectConfiguration: async (action, surface) => {
        this.loads.get(surface)?.abort();
        const controller = new AbortController();
        this.loads.set(surface, controller);
        this.controllers.add(controller);
        const cwd = this.context.cwd(surface);
        try {
          if (!cwd || !findProfile(action.agent))
            throw new Error('Select a project and an agent profile.');
          const key = this.context.skillKey(action.agent, cwd);
          const target = agentTarget(action.agent);
          const launcher = launcherFor(target.provider, target.profileId);
          const inspection = await inspectConfiguration({
            provider: target.provider,
            cwd,
            signal: controller.signal,
            runtimeHome:
              target.provider === 'claude'
                ? (launcher.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR)
                : (launcher.env?.CODEX_HOME ?? process.env.CODEX_HOME),
          });
          if (
            controller.signal.aborted ||
            this.context.cwd(surface) !== cwd ||
            this.context.skillKey(action.agent, cwd) !== key
          )
            return;
          await surface.webview.postMessage({
            type: 'configurationResult',
            requestId: action.requestId,
            agent: action.agent,
            inspection: {
              ...inspection,
              host: vscode.env.remoteName ?? 'local extension host',
              nativeVersion: findProfile(action.agent)?.version,
            },
          });
        } catch {
          if (!controller.signal.aborted)
            await surface.webview.postMessage({
              type: 'configurationResult',
              requestId: action.requestId,
              agent: action.agent,
              error: 'Couldn’t inspect configuration. Select a project and refresh.',
            });
        } finally {
          this.controllers.delete(controller);
        }
      },
    };
  }
}
