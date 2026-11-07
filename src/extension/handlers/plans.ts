import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import {
  type Action,
  type AgentKind,
  type AgentProfile,
  agentKind,
  type BuildChoice,
} from '../../shared/model';
import type { HandlersFor } from '../action-groups';
import { type listDocuments, savePlan } from '../documents';
import type { Surface, Surfaces } from '../surfaces';

export interface PlansHandlersContext {
  sessions: Pick<
    Sessions,
    'get' | 'handOffPlan' | 'buildPlan' | 'currentPlanText' | 'keepPlanning' | 'send'
  >;
  startThread(action: Extract<Action, { type: 'start' }>, surface: Surface): Promise<void>;
  terminals: Map<string, { terminal: vscode.Terminal; openedAt: number }>;
  requireAgent(id: AgentKind): AgentProfile;
  cachedDocuments: Map<string, Awaited<ReturnType<typeof listDocuments>>>;
  surfaces: Pick<Surfaces, 'codeColumn'>;
  publish(full?: boolean): Promise<void>;
}

export class PlansHandlers {
  private building = new Set<string>();
  constructor(private context: PlansHandlersContext) {}
  async flushPlanEdits(id: string): Promise<void> {
    const file = this.context.sessions.get(id).plan?.file;
    const open = vscode.workspace.textDocuments.find((item) => item.fileName === file);
    if (open?.isDirty) await open.save();
  }
  async buildPlan(id: string, choice: BuildChoice, surface: Surface): Promise<void> {
    if (this.building.has(id)) throw new Error('Implementation is already being requested.');
    this.building.add(id);
    try {
      await this.flushPlanEdits(id);
      if (choice.agent) {
        this.context.requireAgent(choice.agent);
        const plan = this.context.sessions.get(id).plan;
        const text = await this.context.sessions.handOffPlan(id, choice.notes);
        await this.context.startThread(
          {
            type: 'start',
            agent: choice.agent,
            model: choice.model,
            effort: choice.effort,
            mode: 'auto',
            text,
            draftKey: '',
            parentId: id,
          },
          surface,
        );
        const session = this.context.sessions.get(id);
        if (session.plan === plan && plan) plan.status = 'approved';
        await this.context.publish();
        return;
      }
      if (this.context.terminals.has(id))
        throw new Error('Close this session’s native terminal before resuming rich chat.');
      const profile = this.context.requireAgent(agentKind(this.context.sessions.get(id)));
      // Codex has no mode that asks before each edit, so it is never pretended.
      if (choice.approvals === 'manual' && profile.provider !== 'claude')
        throw new Error('Approving each edit is available for Claude Code plans only.');
      await this.context.sessions.buildPlan(id, {
        approvals: choice.approvals,
        notes: choice.notes,
      });
    } finally {
      this.building.delete(id);
    }
  }
  async savePlanToWorkspace(id: string): Promise<void> {
    await this.flushPlanEdits(id);
    const session = this.context.sessions.get(id);
    const text = await this.context.sessions.currentPlanText(session);
    const relative = await savePlan(session.cwd, session.title, text);
    this.context.cachedDocuments.delete(session.cwd);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(session.cwd, relative)), {
      viewColumn: this.context.surfaces.codeColumn(),
    });
    await this.context.publish();
  }
  handlers(): HandlersFor<'plans'> {
    return {
      buildPlan: async (action, surface) => {
        await this.buildPlan(action.id, action, surface);
      },
      keepPlanning: async (action) => {
        const session = this.context.sessions.get(action.id);
        if (session.approval?.kind === 'plan') {
          this.context.sessions.keepPlanning(action.id, action.feedback);
          return;
        }
        // No plan request is waiting (Codex never makes one): notes are the next turn, in Plan.
        const feedback = action.feedback?.trim();
        if (!feedback) return;
        if (session.status === 'running' || session.status === 'waiting')
          throw new Error('Wait for this turn or stop it before sending notes.');
        await this.context.sessions.send(action.id, feedback);
      },
      viewPlan: async (action) => {
        const file = this.context.sessions.get(action.id).plan?.file;
        if (!file) throw new Error('This plan has no saved file.');
        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
      },
      editPlan: async (action) => {
        const file = this.context.sessions.get(action.id).plan?.file;
        if (!file) throw new Error('This plan has no saved file.');
        await vscode.window.showTextDocument(vscode.Uri.file(file), {
          viewColumn: this.context.surfaces.codeColumn(),
        });
      },
      savePlan: async (action) => {
        await this.savePlanToWorkspace(action.id);
      },
    };
  }
}
