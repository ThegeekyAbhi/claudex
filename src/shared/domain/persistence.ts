import { z } from 'zod';
import { agentModeEnum } from './modes';
import { LEGACY_SECOND_CLAUDE, PROFILE_ID } from './profiles';
import { attachmentSchema, IMAGE_FILE, type Session } from './session';

const persistedDiff = z.object({
  path: z.string(),
  kind: z.enum(['add', 'update', 'delete', 'rename']),
  patch: z.string(),
  additions: z.number(),
  deletions: z.number(),
  original: z.string().optional(),
  truncated: z.boolean().optional(),
  binary: z.boolean().optional(),
});
const persistedSession = z.object({
  id: z.string(),
  provider: z.enum(['codex', 'claude']),
  /** Before profiles, the second Claude account was saved this way. Read, then turned into a profile id. */
  claudeCommand: z.enum(['claude', 'claud2']).optional(),
  profileId: z.string().regex(PROFILE_ID).optional(),
  title: z.string(),
  pinned: z.boolean().optional(),
  titleSource: z.enum(['prompt', 'provider', 'user']).optional(),
  cwd: z.string(),
  workspace: z.string(),
  nativeId: z.string().optional(),
  nativeSyncedAt: z.number().optional(),
  origin: z.literal('terminal').optional(),
  parentId: z.string().optional(),
  continuedFrom: z.string().optional(),
  synced: z.record(z.string(), z.string()).optional(),
  observed: z.boolean().optional(),
  delegated: z.boolean().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  thinking: z.enum(['default', 'on', 'off']).optional(),
  activeModel: z.string().optional(),
  adaptiveThinking: z.boolean().optional(),
  // Agent no longer exists. Those threads go back to unset, not Auto, so none gains a new reviewer.
  mode: z.preprocess((value) => (value === 'agent' ? undefined : value), agentModeEnum.optional()),
  reportedMode: z.string().optional(),
  nativeSettings: z
    .object({
      approvalPolicy: z.unknown(),
      approvalsReviewer: z.unknown(),
      sandbox: z.unknown(),
    })
    .optional(),
  plan: z
    .object({
      text: z.string(),
      status: z.enum(['drafting', 'ready', 'incomplete', 'approved']),
      updatedAt: z.number(),
      file: z.string().optional(),
      after: z.string().optional(),
    })
    .optional(),
  usage: z
    .object({
      context: z.object({ used: z.number(), max: z.number() }).optional(),
      limits: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            usedPercent: z.number(),
            resetsAt: z.number().optional(),
          }),
        )
        .optional(),
      updatedAt: z.number(),
    })
    .optional(),
  status: z.enum(['idle', 'running', 'waiting', 'completed', 'failed', 'interrupted']),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant', 'tool', 'notice', 'thinking', 'image']),
      text: z.string(),
      attachments: z.array(attachmentSchema).optional(),
      image: z
        .object({
          status: z.enum(['generating', 'ready', 'failed']),
          file: z.string().regex(IMAGE_FILE).optional(),
          prompt: z.string().optional(),
          failure: z.string().optional(),
        })
        .optional(),
      startedAt: z.number().optional(),
      endedAt: z.number().optional(),
      planningGuideVersion: z.string().optional(),
      explainGuideVersion: z.string().optional(),
      nativeRef: z.string().optional(),
      tool: z
        .object({
          kind: z.enum(['command', 'read', 'edit', 'search', 'web', 'agent', 'skill', 'other']),
          name: z.string(),
          title: z.string(),
          pinned: z.boolean().optional(),
          status: z.enum(['running', 'completed', 'failed', 'declined', 'interrupted']),
          input: z.string().optional(),
          diffs: z.array(persistedDiff).optional(),
          diffSource: z.literal('filesystem').optional(),
          captureNote: z.string().optional(),
          workerId: z.string().optional(),
          durationMs: z.number().optional(),
          exitCode: z.number().optional(),
          skill: z
            .object({
              name: z.string(),
              path: z.string().optional(),
              phase: z.enum(['read', 'invoke']),
            })
            .optional(),
        })
        .optional(),
    }),
  ),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const savedState = z.object({ version: z.literal(1), sessions: z.array(persistedSession) });
export function restoreSessions(value: unknown): Session[] {
  return savedState.parse(value).sessions.map(({ claudeCommand, ...session }) => {
    const unfinished = ['running', 'waiting'].includes(session.status);
    const profileId =
      session.profileId ??
      (session.provider === 'claude' && claudeCommand === 'claud2'
        ? LEGACY_SECOND_CLAUDE
        : undefined);
    return {
      ...session,
      ...(profileId ? { profileId } : {}),
      status: unfinished ? 'interrupted' : session.status,
      ...(session.plan?.status === 'drafting'
        ? { plan: { ...session.plan, status: 'incomplete' as const } }
        : {}),
      // Nothing that never reported an outcome may keep claiming to run after a restart.
      messages: session.messages.flatMap((message) => {
        if (message.tool?.status === 'running') {
          const interrupted = {
            ...message,
            tool: { ...message.tool, status: 'interrupted' as const },
          };
          // A delegation's result was owed to the lead; say plainly that it never arrived.
          return message.tool.kind === 'agent' && !session.observed
            ? [
                interrupted,
                {
                  id: `${message.id}-interrupted`,
                  role: 'notice' as const,
                  text: 'This delegation was interrupted when the window closed. Its result never reached this thread.',
                },
              ]
            : [interrupted];
        }
        if (message.image?.status === 'generating')
          return {
            ...message,
            image: {
              ...message.image,
              status: 'failed' as const,
              failure: 'The window closed before this finished.',
            },
          };
        return [message];
      }),
    };
  });
}
/**
 * A saved thread as an older Claudex would read it too: the old second-Claude marker is kept, so
 * going back a version doesn't move those threads to the first account.
 */
export function persistableSession<T extends { provider: string; profileId?: string }>(
  session: T,
): T & { claudeCommand?: 'claud2' } {
  return session.provider === 'claude' && session.profileId === LEGACY_SECOND_CLAUDE
    ? { ...session, claudeCommand: LEGACY_SECOND_CLAUDE }
    : session;
}
