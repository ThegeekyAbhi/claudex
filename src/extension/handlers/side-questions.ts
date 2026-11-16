import type { Sessions } from '../../application/sessions/session-manager';
import type { Launcher } from '../../providers/registry';
import { askClaude, askCodex, type SideQuestion } from '../../providers/side-question';
import { type AgentKind, type AgentProfile, agentKind, type Provider } from '../../shared/model';
import type { Action } from '../../shared/protocol/actions';
import type { HandlersFor } from '../action-groups';
import type { Surface } from '../surfaces';

type SideQuestionAction = Extract<Action, { type: 'sideQuestion' }>;

export interface SideQuestionsContext {
  sessions: Pick<Sessions, 'get'>;
  requireAgent(id: AgentKind): AgentProfile;
  launcherFor(provider: Provider, profileId?: string): Launcher;
  output: { appendLine(text: string): void };
}

interface SideAnswerUpdate {
  delta?: string;
  activity?: string;
  done?: boolean;
  error?: string;
}

/** At most a few at once: each starts its own CLI process. */
const MAX_RUNNING = 3;

/**
 * `/btw` questions. The answer streams to the webview that asked and is never written to the
 * thread, so a side question can't change what the agent is doing or what it remembers.
 */
export class SideQuestionsHandlers {
  private running = new Set<{ requestId: string; surface: Surface; controller: AbortController }>();
  constructor(
    private context: SideQuestionsContext,
    private ask: Record<Provider, (question: SideQuestion) => Promise<void>> = {
      claude: (question) => askClaude(question),
      codex: askCodex,
    },
  ) {}
  handlers(): HandlersFor<'sideQuestions'> {
    return {
      // Answers in the background. Never throws: every request, refused or not, ends with exactly
      // one `done` the asking view can match, so nothing is left answering.
      sideQuestion: async (action, surface) => {
        void this.answer(action, surface);
      },
      stopSideQuestion: async (action, surface) => {
        for (const active of this.running)
          if (active.requestId === action.requestId && active.surface === surface)
            active.controller.abort();
      },
    };
  }
  private async answer(action: SideQuestionAction, surface: Surface): Promise<void> {
    // Request IDs belong to the asking surface; replaying an active request is idempotent.
    if (
      [...this.running].some(
        (active) => active.requestId === action.requestId && active.surface === surface,
      )
    )
      return;
    const post = (message: SideAnswerUpdate) =>
      void surface.webview.postMessage({
        type: 'sideAnswer',
        requestId: action.requestId,
        ...message,
      });
    const controller = new AbortController();
    const active = { requestId: action.requestId, surface, controller };
    try {
      if (this.running.size >= MAX_RUNNING)
        throw new Error('Wait for a side question to finish before asking another.');
      this.running.add(active);
      const session = this.context.sessions.get(action.id);
      this.context.requireAgent(agentKind(session));
      await this.ask[session.provider]({
        session,
        launcher: this.context.launcherFor(session.provider, session.profileId),
        text: action.text,
        earlier: action.earlier,
        signal: controller.signal,
        onText: (delta) => post({ delta }),
        onActivity: (activity) => post({ activity }),
      });
      post({ done: true });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.context.output.appendLine(`Side question failed: ${text}`);
      post({ done: true, ...(controller.signal.aborted ? {} : { error: text }) });
    } finally {
      this.running.delete(active);
    }
  }
  dispose(): void {
    for (const active of this.running) active.controller.abort();
  }
}
