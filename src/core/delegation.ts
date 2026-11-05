import { z } from 'zod';
import { AGENT_LABELS, type AgentKind, type Status } from './agents';

export interface DelegateRequest {
  agent: AgentKind;
  prompt: string;
  model?: string;
  effort?: string;
}
export interface DelegateResult {
  sessionId: string;
  status: Status;
  text: string;
}
/** Starts one agent as a child thread and resolves when that thread's turn ends. */
export type Delegate = (
  request: DelegateRequest,
  onStart?: (sessionId: string) => void,
) => Promise<DelegateResult>;

export const RUN_AGENT_TOOL = 'run_agent';
export const RUN_AGENT_DESCRIPTION =
  'Run another installed coding agent (Codex, Claude, or Claude 2) on a task in this workspace. ' +
  'Use this instead of launching a CLI from a shell whenever the user asks you to run, ask, or ' +
  'hand a task to another agent. The user approves each call, the agent appears as a child ' +
  'thread they can watch, and its final message is returned to you. The prompt must be ' +
  'self-contained because the other agent cannot see this conversation.';
export const runAgentInput = z.object({
  agent: z.enum(['codex', 'claude', 'claude2']),
  prompt: z.string().trim().min(1).max(200_000),
  model: z.string().max(200).optional(),
  effort: z.string().max(40).optional(),
});
export const RUN_AGENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    agent: {
      type: 'string',
      enum: ['codex', 'claude', 'claude2'],
      description: 'Which agent to run.',
    },
    prompt: { type: 'string', description: 'The complete task for that agent.' },
    model: { type: 'string', description: 'Optional model id. Omit to use the agent default.' },
    effort: { type: 'string', description: 'Optional reasoning effort. Omit for the default.' },
  },
  required: ['agent', 'prompt'],
  additionalProperties: false,
} as const;
export function parseRunAgent(value: unknown): DelegateRequest {
  const input = runAgentInput.parse(value);
  return {
    agent: input.agent === 'claude2' ? 'claud2' : input.agent,
    prompt: input.prompt,
    model: input.model,
    effort: input.effort,
  };
}
export function runAgentApprovalTitle(request: DelegateRequest): string {
  return `Run ${AGENT_LABELS[request.agent]} agent?`;
}
export function runAgentResultText(request: DelegateRequest, result: DelegateResult): string {
  const label = AGENT_LABELS[request.agent];
  const body = result.text || '(The agent did not send a final message.)';
  return `${label} finished this turn with status "${result.status}".\n\n${body}`;
}
