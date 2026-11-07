import { z } from 'zod';
import type { AgentKind } from '../domain/agents';
import { agentModeEnum } from '../domain/modes';
import { APPEARANCES } from '../domain/preferences';
import { findProfile, PROFILE_ID } from '../domain/profiles';
import { attachmentSchema, IMAGE_FILE } from '../domain/session';

/** A profile that exists now. The host also checks it can run before starting anything. */
const agentEnum = z
  .string()
  .regex(PROFILE_ID)
  .refine((id) => findProfile(id) !== undefined, { message: 'Unknown agent.' });
const optionName = z.string().min(1).max(200);
const attachments = z.array(attachmentSchema).max(30).optional();
const thinking = z.enum(['default', 'on', 'off']);
const buildChoice = {
  agent: agentEnum.optional(),
  model: optionName.optional(),
  effort: optionName.optional(),
  /** Auto, or the CLI's own default so each edit comes to you. Only Claude Code has the latter. */
  approvals: z.enum(['auto', 'manual']).optional(),
  notes: z.string().max(200_000).optional(),
};
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('setAppearance'), appearance: z.enum(APPEARANCES) }),
  z.object({
    type: z.literal('setGuide'),
    guide: z.enum(['guidedPlanning', 'richExplanations']),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal('dismissOnboarding') }),
  z.object({ type: z.literal('link'), href: z.string().max(4096) }),
  z.object({ type: z.literal('compose') }),
  z.object({ type: z.literal('continueChat'), id: z.string().max(200), agent: agentEnum }),
  z.object({ type: z.literal('openChat'), id: z.string().optional() }),
  z.object({
    type: z.literal('start'),
    agent: agentEnum,
    text: z.string().trim().min(1).max(200_000),
    draftKey: z.string().max(200),
    model: optionName.optional(),
    effort: optionName.optional(),
    thinking: thinking.optional(),
    parentId: z.string().optional(),
    worktree: z.boolean().optional(),
    mode: agentModeEnum.optional(),
    /** A first message that mentions an agent: it runs in a card, and `agent` stays the main one. */
    delegate: agentEnum.optional(),
    /** The thread this one continues in another agent. Its checkout is used. */
    continuedFrom: z.string().max(200).optional(),
    attachments,
  }),
  z.object({
    type: z.literal('previewContext'),
    /** The thread the context comes from. */
    id: z.string().max(200),
    history: z.enum(['recent', 'full']),
    /** The thread that will receive it, if it exists yet, so only what it hasn't seen shows. */
    targetId: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('send'),
    id: z.string(),
    text: z.string().trim().min(1).max(200_000),
    attachments,
  }),
  z.object({
    type: z.literal('delegate'),
    id: z.string(),
    agent: agentEnum,
    text: z.string().trim().min(1).max(200_000),
    draftKey: z.string().max(200),
    attachments,
  }),
  z.object({
    type: z.literal('setModel'),
    id: z.string(),
    model: optionName.nullable(),
    effort: optionName.nullable(),
  }),
  z.object({ type: z.literal('refreshModels') }),
  z.object({ type: z.literal('setThinking'), id: z.string(), thinking }),
  z.object({ type: z.literal('resumeInAuto'), id: z.string(), requestId: z.string() }),
  z.object({ type: z.literal('interrupt'), id: z.string() }),
  z.object({ type: z.literal('terminal'), id: z.string() }),
  z.object({ type: z.literal('refreshNativeSessions') }),
  z.object({
    type: z.literal('openNativeSession'),
    agent: agentEnum,
    sessionId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[\w.-]+$/),
  }),
  z.object({ type: z.literal('terminalBack'), id: z.string() }),
  z.object({ type: z.literal('select'), id: z.string() }),
  z.object({ type: z.literal('rename'), id: z.string() }),
  z.object({ type: z.literal('pin'), id: z.string(), pinned: z.boolean() }),
  z.object({ type: z.literal('deleteThread'), id: z.string() }),
  z.object({
    type: z.literal('approve'),
    id: z.string(),
    requestId: z.string(),
    allowed: z.boolean(),
    /** Allows this request, then continues in the provider's Auto mode. */
    auto: z.boolean().optional(),
    answers: z.record(z.string(), z.string()).default({}),
  }),
  z.object({ type: z.literal('document'), path: z.string(), preview: z.boolean().optional() }),
  z.object({
    type: z.literal('template'),
    kind: z.enum(['plan', 'task', 'review', 'handoff']),
    id: z.string().optional(),
  }),
  z.object({ type: z.literal('handoff'), id: z.string() }),
  z.object({
    type: z.literal('changes'),
    id: z.string(),
    requestId: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal('reviewChanges'),
    id: z.string(),
    file: z.string().max(4096).optional(),
  }),
  z.object({
    type: z.literal('openDiff'),
    id: z.string(),
    file: z.string().max(4096),
    original: z.string().max(4096).optional(),
  }),
  z.object({ type: z.literal('worktree'), id: z.string() }),
  z.object({ type: z.literal('setMode'), id: z.string(), mode: agentModeEnum }),
  z.object({ type: z.literal('buildPlan'), id: z.string(), ...buildChoice }),
  z.object({
    type: z.literal('keepPlanning'),
    id: z.string(),
    feedback: z.string().max(200_000).optional(),
  }),
  z.object({ type: z.literal('viewPlan'), id: z.string() }),
  z.object({ type: z.literal('editPlan'), id: z.string() }),
  z.object({ type: z.literal('refreshSkills'), agent: agentEnum }),
  z.object({
    type: z.literal('openSkill'),
    agent: agentEnum,
    name: optionName,
    path: z.string().max(4096),
  }),
  z.object({
    type: z.literal('setSkillEnabled'),
    agent: agentEnum,
    name: optionName,
    path: z.string().max(4096),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal('savePlan'), id: z.string() }),
  z.object({
    type: z.literal('profileRequest'),
    requestId: z.string().min(1).max(100),
    request: z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('pickFolder') }),
      z.object({
        operation: z.literal('create'),
        provider: z.enum(['claude', 'codex']),
        name: z.string().trim().min(1).max(60),
        id: z.string().regex(PROFILE_ID),
        folder: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('new') }),
          z.object({ kind: z.literal('suggested'), path: z.string().max(4096) }),
          z.object({ kind: z.literal('picked'), token: z.string().max(100) }),
        ]),
        executable: z.string().trim().min(1).max(4096).optional(),
      }),
      z.object({
        operation: z.literal('rename'),
        id: agentEnum,
        name: z.string().trim().min(1).max(60),
      }),
      z.object({ operation: z.literal('remove'), id: agentEnum }),
      z.object({ operation: z.literal('signIn'), id: agentEnum }),
    ]),
  }),
  // Profiles. Names and folders are asked for in VS Code's own prompts, not taken from here.
  z.object({
    type: z.literal('addProfile'),
    provider: z.enum(['claude', 'codex']).optional(),
    /** A suggested folder the host found. It is checked against its own list again. */
    folder: z.string().max(4096).optional(),
  }),
  z.object({ type: z.literal('saveProfile'), id: agentEnum }),
  z.object({ type: z.literal('renameProfile'), id: agentEnum }),
  z.object({ type: z.literal('removeProfile'), id: agentEnum }),
  z.object({ type: z.literal('signInProfile'), id: agentEnum }),
  z.object({
    type: z.literal('openProfileFolder'),
    id: agentEnum,
    folder: z.enum(['home', 'skills']).optional(),
  }),
  z.object({ type: z.literal('refreshAgents') }),
  z.object({ type: z.literal('copy'), text: z.string().max(2_000_000) }),
  z.object({
    type: z.literal('searchContext'),
    requestId: z.number(),
    query: z.string().max(300),
  }),
  z.object({ type: z.literal('pickImages'), draftKey: z.string().max(200) }),
  // About 10 MB of image once decoded; the store checks the real size and type.
  z.object({
    type: z.literal('attachImage'),
    draftKey: z.string().max(200),
    name: z.string().max(260),
    data: z.string().max(14_000_000),
  }),
  z.object({
    type: z.literal('openImage'),
    file: z.string().regex(IMAGE_FILE),
    reveal: z.boolean().optional(),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

/** Messages from the plan editor, which is a separate webview with a smaller job. */
export const planViewActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('planReady') }),
  z.object({ type: z.literal('planBuild'), ...buildChoice }),
  z.object({ type: z.literal('planOpenAsText') }),
  z.object({ type: z.literal('planSave') }),
  z.object({ type: z.literal('planCopy') }),
]);
export type PlanViewAction = z.infer<typeof planViewActionSchema>;
export type BuildChoice = {
  agent?: AgentKind;
  model?: string;
  effort?: string;
  approvals?: 'auto' | 'manual';
  notes?: string;
};
