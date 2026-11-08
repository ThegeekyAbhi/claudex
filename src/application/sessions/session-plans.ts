import { randomUUID } from 'node:crypto';
import {
  applyTranscript,
  canBuildPlan,
  limitFailure,
  planWithNotes,
  type Session,
  type SessionInput,
} from '../../shared/model';

/** How you chose to build: Auto, or each edit approved by you; and anything you added. */
export interface BuildOptions {
  approvals?: 'auto' | 'manual';
  notes?: string;
}

import type { PlanFiles } from './session-types';

interface Dependencies {
  planFiles?: PlanFiles;
  assertAvailable(id: string): void;
  get(id: string): Session;
  changed(): void;
  currentPlanText(session: Session): Promise<string>;
  keepPlanning(id: string, feedback?: string): void;
  approve(id: string, requestId: string, allowed: boolean, answers: Record<string, string>): void;
  send(id: string, text: string, input?: SessionInput): Promise<void>;
}

export class SessionPlans {
  private building = new Set<string>();
  constructor(private deps: Dependencies) {}
  /**
   * Your decision to build. A provider still waiting on its plan request gets that answer;
   * otherwise building is an ordinary next turn. Either way this says nothing about the result.
   */
  /** Never holds up the agent, and a failed write only costs the file, not the plan. */
  savePlanFile(session: Session, text: string): void {
    this.deps.planFiles
      ?.save(session, text)
      .then((file) => {
        if (session.plan?.text !== text) return;
        session.plan.file = file;
        this.deps.changed();
      })
      .catch((error) =>
        applyTranscript(session, {
          type: 'message',
          message: {
            id: randomUUID(),
            role: 'notice',
            text: `The plan couldn’t be saved as a file: ${String(error)}`,
          },
        }),
      );
  }
  /** The plan as you left it: the file if there is one, because you may have edited it. */
  async currentPlanText(session: Session): Promise<string> {
    if (!session.plan) throw new Error('This thread has no plan.');
    if (!session.plan.file || !this.deps.planFiles) return session.plan.text;
    const text = await this.deps.planFiles
      .read(session.plan.file)
      .catch(() => session.plan?.text ?? '');
    if (!text.trim()) throw new Error('The plan file is empty.');
    return text;
  }
  async buildPlan(id: string, options: BuildOptions = {}): Promise<void> {
    if (this.building.has(id)) throw new Error('Implementation is already being requested.');
    this.building.add(id);
    try {
      await this.buildReadyPlan(id, options);
    } finally {
      this.building.delete(id);
    }
  }
  private async buildReadyPlan(id: string, options: BuildOptions): Promise<void> {
    this.deps.assertAvailable(id);
    const session = this.deps.get(id);
    if (!session.plan) throw new Error('This thread has no plan to build.');
    const waiting = () => {
      const request = session.approval?.kind === 'plan' ? session.approval : undefined;
      if (!request && (session.status === 'running' || session.status === 'waiting'))
        throw new Error('Wait for this turn or stop it before building the plan.');
      return request;
    };
    waiting();
    if (!canBuildPlan(session)) throw new Error('Wait for a finished plan before implementing.');
    const plan = session.plan;
    const text = planWithNotes(await this.deps.currentPlanText(session), options.notes);
    const request = waiting();
    if (session.plan !== plan || !canBuildPlan(session) || !text.trim())
      throw new Error('The plan changed or is no longer ready. Review it before implementing.');
    const edited = text.trim() !== session.plan.text.trim();
    const before = {
      mode: session.mode,
      reportedMode: session.reportedMode,
      status: session.plan.status,
    };
    session.plan.text = text;
    // Manual leaves the mode unset, so the CLI's own default asks before each edit.
    session.mode = options.approvals === 'manual' ? undefined : 'auto';
    delete session.reportedMode;
    session.plan.status = 'approved';
    if (request) {
      this.deps.approve(id, request.id, true, edited ? { plan: text } : {});
      return;
    }
    // A build that couldn't run didn't start: put things back so it can be tried again.
    const restore = () => {
      session.mode = before.mode;
      if (before.reportedMode) session.reportedMode = before.reportedMode;
      else delete session.reportedMode;
      if (session.plan) session.plan.status = before.status;
      this.deps.changed();
    };
    try {
      await this.deps.send(
        id,
        edited ? `Implement this plan. I edited it:\n\n${text}` : 'Implement the plan.',
      );
    } catch (error) {
      restore();
      throw error;
    }
    // A usage limit means the CLI got the request and answered it, so your decision stands:
    // the plan stays approved in the mode you chose, ready to continue once the limit resets.
    if (session.status === 'failed' && !limitFailure(session)) restore();
  }
  /** The prompt for another agent, which hasn't seen this thread. */
  async handOffPlan(id: string, notes?: string): Promise<string> {
    const session = this.deps.get(id);
    this.deps.assertAvailable(id);
    if (!canBuildPlan(session)) throw new Error('Wait for a finished plan before implementing.');
    const plan = session.plan;
    const text = planWithNotes(await this.deps.currentPlanText(session), notes);
    if (session.plan !== plan || !canBuildPlan(session) || !text.trim())
      throw new Error('The plan changed or is no longer ready.');
    if (session.approval?.kind === 'plan') this.deps.keepPlanning(id);
    return `Implement this plan:\n\n${text}`;
  }
  /** Declines a pending plan request, so the agent stays in plan mode for your feedback. */
  /** What you type while a plan waits is your feedback on it, and goes back with the answer. */
  keepPlanning(id: string, feedback?: string): void {
    const session = this.deps.get(id);
    if (session.approval?.kind !== 'plan') return;
    if (feedback)
      applyTranscript(session, {
        type: 'message',
        message: { id: randomUUID(), role: 'user', text: feedback },
      });
    this.deps.approve(id, session.approval.id, false, feedback ? { feedback } : {});
  }
}
