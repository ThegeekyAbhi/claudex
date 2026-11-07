import {
  type AgentKind,
  type AgentMode,
  agentKind,
  agentTarget,
  chooseNudge,
  mentionedAgent,
  modeView,
  newChatMode,
  parseMention,
  sameSkill,
  skillsFor,
  type Thinking,
  thinkingSupport,
} from '../../../shared/model';
import { api, send } from '../../app/bridge';
import { effortsFor, keepEffort, modelOption } from './model-options';
import type { ComposerProps } from './types';
import { useContextInput } from './use-context-input';

export function useComposer({
  catalog,
  skills,
  session,
  choice,
  draft,
  attachments,
  draftKey,
  busy,
  trusted,
  focusKey,
  top,
  onDraft,
  onAttachments,
  onChoice,
  onMode,
  dismissedNudges,
  onError,
}: ComposerProps) {
  const agent = session ? agentKind(session) : choice.agent;
  const model = session ? session.model : choice.model;
  const effort = session ? session.effort : choice.effort;
  const requestedMode = session ? session.mode : newChatMode(choice.modes?.[agent]);
  const nudge = chooseNudge(session, agent, requestedMode, dismissedNudges);
  const modeLocked = busy || Boolean(session?.transition) || session?.status === 'waiting';
  const thinking = (session ? session.thinking : choice.thinking) ?? 'default';
  const support = thinkingSupport(
    agentTarget(agent).provider,
    modelOption(catalog, agent, model ?? session?.activeModel),
  );
  const modeShown = modeView(requestedMode, session?.reportedMode);
  const efforts = effortsFor(catalog, agent, model);
  const mention = parseMention(draft);
  const canDelegate = Boolean(session && mention && !session.observed);
  const target = session?.observed ? undefined : mentionedAgent(draft);
  // The pill already names the target, so a bare mention must not send to the current agent.
  const needsPrompt = Boolean(target && !mention);
  // Only a catalog that has finished loading can say a skill is missing.
  const missingSkills =
    skillsFor(skills, agent).status === 'ready'
      ? attachments.filter(
          (item) =>
            item.kind === 'skill' &&
            !skillsFor(skills, agent).skills.some(
              (skill) => skill.enabled && sameSkill(skill, item),
            ),
        )
      : [];
  const noImages =
    attachments.some((item) => item.kind === 'image') &&
    modelOption(catalog, mention?.agent ?? agent, mention ? undefined : model)?.images === false;
  const input = useContextInput({
    draft,
    attachments,
    draftKey,
    focusKey,
    onDraft,
    onAttachments,
    onError,
    agent,
  });
  const focusInput = () => input.textarea.current?.focus();
  // A new chat's composer is at the top of the page, so its menus have room below.
  const menuSide = top ? ('bottom' as const) : ('top' as const);
  function selectModel(next: { agent: AgentKind; model?: string }) {
    if (session && next.agent !== agent) {
      // A provider session cannot change agent, so the draft moves to a new thread.
      onChoice({ agent: next.agent, model: next.model }, true);
      return;
    }
    const nextEffort = keepEffort(catalog, next.agent, next.model, effort);
    if (session)
      send({
        type: 'setModel',
        id: session.id,
        model: next.model ?? null,
        effort: nextEffort ?? null,
      });
    else {
      const available = thinkingSupport(
        agentTarget(next.agent).provider,
        modelOption(catalog, next.agent, next.model),
      );
      const keep = thinking === 'default' || (thinking === 'on' ? available.on : available.off);
      onChoice({
        ...choice,
        agent: next.agent,
        model: next.model,
        effort: nextEffort,
        thinking: keep ? thinking : 'default',
      });
      if (!keep) onError('Thinking reset to Default for the new model.');
    }
  }
  function selectEffort(next?: string) {
    if (session)
      send({ type: 'setModel', id: session.id, model: model ?? null, effort: next ?? null });
    else onChoice({ ...choice, effort: next });
  }
  function selectThinking(next: Thinking) {
    if (session) send({ type: 'setThinking', id: session.id, thinking: next });
    else onChoice({ ...choice, thinking: next });
  }
  function selectMode(next: AgentMode) {
    if (session) send({ type: 'setMode', id: session.id, mode: next });
    onMode(agent, next);
  }
  const guide =
    modeShown.mode === 'plan'
      ? ({ key: 'guidedPlanning', label: 'Planning guide', icon: 'plan' } as const)
      : modeShown.mode === 'ask'
        ? ({ key: 'richExplanations', label: 'Visual explanations', icon: 'logo' } as const)
        : undefined;
  const worktree = session ? session.cwd !== session.workspace : Boolean(choice.worktree);
  const blocked = !trusted || !api;
  return {
    ...input,
    agent,
    model,
    effort,
    nudge,
    modeLocked,
    thinking,
    support,
    modeShown,
    efforts,
    mention,
    canDelegate,
    target,
    needsPrompt,
    missingSkills,
    noImages,
    focusInput,
    menuSide,
    selectModel,
    selectEffort,
    selectThinking,
    selectMode,
    guide,
    worktree,
    blocked,
  };
}
