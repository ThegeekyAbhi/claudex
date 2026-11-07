import { z } from 'zod';
import type { AgentKind, Status } from './agents';
import {
  canRun,
  findProfile,
  mentionNames,
  profileLabel,
  resolveAgentName,
  runnableProfiles,
} from './profiles';

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
/** Named per thread from the agents installed now, so an agent only offers ones that can run. */
export function runAgentDescription(): string {
  const names = runnableProfiles()
    .map((profile) => `${profile.id} (${profile.label})`)
    .join(', ');
  return (
    `Run another installed coding agent (${names}) on a task in this workspace. ` +
    'Use this instead of launching a CLI from a shell whenever the user asks you to run, ask, or ' +
    'hand a task to another agent. The user approves each call, the agent appears as a child ' +
    'thread they can watch, and its final message is returned to you. The prompt must be ' +
    'self-contained because the other agent cannot see this conversation.'
  );
}
/** Profile ids that can run, plus old names that still point at one. */
export function runAgentNames(): [string, ...string[]] {
  const runnable = new Set(runnableProfiles().map((profile) => profile.id));
  const names = mentionNames().filter((name) => {
    const id = resolveAgentName(name);
    return id !== undefined && runnable.has(id);
  });
  return names.length ? (names as [string, ...string[]]) : ['codex'];
}
const agentName = z
  .string()
  .max(40)
  .transform((value, context) => {
    const id = resolveAgentName(value);
    const profile = id ? findProfile(id) : undefined;
    if (!id || !profile || !canRun(profile)) {
      context.addIssue({
        code: 'custom',
        message: `No runnable agent named “${value}”. Use one of: ${runAgentNames().join(', ')}.`,
      });
      return z.NEVER;
    }
    return id;
  });
export const runAgentInput = z.object({
  agent: agentName,
  prompt: z.string().trim().min(1).max(200_000),
  model: z.string().max(200).optional(),
  effort: z.string().max(40).optional(),
});
export function runAgentJsonSchema() {
  return {
    type: 'object',
    properties: {
      agent: { type: 'string', enum: runAgentNames(), description: 'Which agent to run.' },
      prompt: { type: 'string', description: 'The complete task for that agent.' },
      model: { type: 'string', description: 'Optional model id. Omit to use the agent default.' },
      effort: { type: 'string', description: 'Optional reasoning effort. Omit for the default.' },
    },
    required: ['agent', 'prompt'],
    additionalProperties: false,
  } as const;
}
export function parseRunAgent(value: unknown): DelegateRequest {
  const input = runAgentInput.parse(value);
  return {
    agent: input.agent,
    prompt: input.prompt,
    model: input.model,
    effort: input.effort,
  };
}
export function runAgentApprovalTitle(request: DelegateRequest): string {
  return `Run ${profileLabel(request.agent)} agent?`;
}
export function runAgentResultText(request: DelegateRequest, result: DelegateResult): string {
  const label = profileLabel(request.agent);
  const body = result.text || '(The agent did not send a final message.)';
  return `${label} finished this turn with status "${result.status}".\n\n${body}`;
}
