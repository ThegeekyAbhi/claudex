import { z } from 'zod';
import type { AgentKind } from './agents';
import { agentModeEnum } from './modes';
import { attachmentSchema, IMAGE_FILE } from './session';

const agentEnum = z.enum(['codex', 'claude', 'claud2']);
const optionName = z.string().min(1).max(200);
const attachments = z.array(attachmentSchema).max(30).optional();
const thinking = z.enum(['default', 'on', 'off']);
const buildChoice = {
  mode: z.enum(['agent', 'auto']).optional(),
  agent: agentEnum.optional(),
  model: optionName.optional(),
  effort: optionName.optional(),
};
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('link'), href: z.string().max(4096) }),
  z.object({ type: z.literal('compose') }),
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
    attachments,
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
  z.object({ type: z.literal('select'), id: z.string() }),
  z.object({ type: z.literal('rename'), id: z.string() }),
  z.object({ type: z.literal('pin'), id: z.string(), pinned: z.boolean() }),
  z.object({ type: z.literal('deleteThread'), id: z.string() }),
  z.object({
    type: z.literal('approve'),
    id: z.string(),
    requestId: z.string(),
    allowed: z.boolean(),
    answers: z.record(z.string(), z.string()).default({}),
  }),
  z.object({ type: z.literal('document'), path: z.string(), preview: z.boolean().optional() }),
  z.object({
    type: z.literal('template'),
    kind: z.enum(['plan', 'task', 'review', 'handoff']),
    id: z.string().optional(),
  }),
  z.object({ type: z.literal('handoff'), id: z.string() }),
  z.object({ type: z.literal('changes'), id: z.string() }),
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
  mode?: 'agent' | 'auto';
  agent?: AgentKind;
  model?: string;
  effort?: string;
};
