import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AGENT_LABELS,
  AGENT_MODES,
  type AgentKind,
  type AgentMode,
  type Attachment,
  agentKind,
  agentTarget,
  attachmentLabel,
  CAPABILITIES,
  type Catalog,
  chooseNudge,
  MODE_LABELS,
  mentionedAgent,
  modeView,
  nextMode,
  parseMention,
  type Session,
  type SkillCatalogs,
  sameSkill,
  THINKING_LABELS,
  type Thinking,
  thinkingSupport,
} from '../../../core/model';
import { api, type ComposeChoice, send } from '../../app/bridge';
import { Icon, type IconName } from '../../components/icons';
import { Menu } from '../../components/menus';
import {
  AttachmentChip,
  ContextMenu,
  type ContextResults,
  requestContext,
  type Trigger,
  triggerAt,
} from '../attachments/context-menu';
import { ModelSelector } from '../models/model-selector';
import { SkillMenu } from '../skills/skill-menu';
import { UsageIndicator } from '../usage/usage-indicator';

function modelOption(catalog: Catalog, agent: AgentKind, model?: string) {
  const models = catalog[agent].models;
  return model
    ? models.find((item) => item.id === model || item.resolvedModel === model)
    : models.find((item) => item.isDefault);
}
function effortsFor(catalog: Catalog, agent: AgentKind, model?: string): string[] {
  return modelOption(catalog, agent, model)?.efforts ?? [];
}
function keepEffort(
  catalog: Catalog,
  agent: AgentKind,
  model: string | undefined,
  effort: string | undefined,
) {
  return effort && effortsFor(catalog, agent, model).includes(effort) ? effort : undefined;
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
const MODE_ICONS: Record<AgentMode, IconName> = {
  ask: 'question',
  plan: 'plan',
  agent: 'agentMode',
  auto: 'autoMode',
};
export function Composer({
  catalog,
  skills,
  onManageSkills,
  session,
  sessions,
  project,
  choice,
  draft,
  attachments,
  draftKey,
  busy,
  trusted,
  focusKey,
  top,
  contextResults,
  onDraft,
  onAttachments,
  onChoice,
  onMode,
  dismissedNudges,
  onDismissNudge,
  onSubmit,
  onError,
}: {
  catalog: Catalog;
  skills: SkillCatalogs;
  onManageSkills: () => void;
  session?: Session;
  sessions: Session[];
  project: string;
  /** Used until a thread exists. */
  choice: ComposeChoice;
  draft: string;
  attachments: Attachment[];
  draftKey: string;
  busy: boolean;
  trusted: boolean;
  focusKey: string;
  /** At the top of a new thread, so menus open downward. */
  top?: boolean;
  contextResults?: ContextResults;
  onDraft: (text: string) => void;
  onAttachments: (attachments: Attachment[]) => void;
  onChoice: (choice: ComposeChoice, carryDraft?: boolean) => void;
  /** Remembers an explicit choice for this agent's next new thread. */
  onMode: (agent: AgentKind, mode: AgentMode) => void;
  dismissedNudges: string[];
  onDismissNudge: (key: string) => void;
  onSubmit: () => void;
  onError: (text: string) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<Trigger>();
  /** Escape hides the menu until the text changes. */
  const [dismissed, setDismissed] = useState<number>();
  const menuKeys = useRef<((event: React.KeyboardEvent) => boolean) | null>(null);
  const requestId = useRef(0);
  const pendingCaret = useRef<number | undefined>(undefined);
  const agent = session ? agentKind(session) : choice.agent;
  const model = session ? session.model : choice.model;
  const effort = session ? session.effort : choice.effort;
  const requestedMode = session ? session.mode : choice.modes?.[agent];
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
    skills[agent].status === 'ready'
      ? attachments.filter(
          (item) =>
            item.kind === 'skill' &&
            !skills[agent].skills.some((skill) => skill.enabled && sameSkill(skill, item)),
        )
      : [];
  const menuOpen = Boolean(trigger) && dismissed !== trigger?.start;
  const noImages =
    attachments.some((item) => item.kind === 'image') &&
    modelOption(catalog, mention?.agent ?? agent, mention ? undefined : model)?.images === false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusing follows a change of thread
  useEffect(() => {
    textarea.current?.focus();
  }, [focusKey]);
  const previousImages = useRef(
    new Set(attachments.filter((item) => item.kind === 'image').map((item) => item.file)),
  );
  const imageCounter = useRef(0);
  // Host image imports arrive asynchronously; insert at the current selection.
  useEffect(() => {
    const images = attachments.filter((item) => item.kind === 'image');
    const added = images.filter(
      (item) => !previousImages.current.has(item.file) && !item.reference,
    );
    previousImages.current = new Set(images.map((item) => item.file));
    imageCounter.current = Math.max(
      imageCounter.current,
      ...images.map((item) => item.reference ?? 0),
      ...Array.from(draft.matchAll(/\[Image #(\d+)\]/g), (match) => Number(match[1])),
    );
    if (!added.length) return;
    const numbered = new Map(added.map((item) => [item.file, ++imageCounter.current]));
    const start = textarea.current?.selectionStart ?? draft.length;
    const end = textarea.current?.selectionEnd ?? start;
    const tags = `${added.map((item) => `[Image #${numbered.get(item.file)}]`).join(' ')} `;
    pendingCaret.current = start + tags.length;
    onAttachments(
      attachments.map((item) =>
        item.kind === 'image' && numbered.has(item.file)
          ? { ...item, reference: numbered.get(item.file) }
          : item,
      ),
    );
    onDraft(draft.slice(0, start) + tags + draft.slice(end));
  }, [attachments, draft, onAttachments, onDraft]);
  const query = trigger?.query;
  const skillTrigger = trigger?.mark === '/';
  // Results are searched by the host, a moment after typing settles.
  useEffect(() => {
    if (query === undefined || !menuOpen || skillTrigger) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => requestContext(id, query), query ? 80 : 0);
    return () => clearTimeout(timer);
  }, [query, menuOpen, skillTrigger]);
  // Refreshed behind the menu, which shows what's already known straight away.
  useEffect(() => {
    if (skillTrigger && menuOpen) send({ type: 'refreshSkills', agent });
  }, [skillTrigger, menuOpen, agent]);
  // In the same commit as the text, so a key pressed right after a pick cannot land before it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: this follows the draft changing
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return;
    textarea.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = undefined;
  }, [draft]);
  const focusInput = () => textarea.current?.focus();
  function readTrigger(element: HTMLTextAreaElement) {
    setTrigger(triggerAt(element.value, element.selectionStart));
  }
  function removeToken() {
    if (!trigger) return draft;
    const next = `${draft.slice(0, trigger.start)}${draft.slice(trigger.end)}`;
    onDraft(next);
    setTrigger(undefined);
    pendingCaret.current = trigger.start;
    textarea.current?.focus();
    return next;
  }
  function attach(attachment: Attachment) {
    removeToken();
    const same = (item: Attachment) => JSON.stringify(item) === JSON.stringify(attachment);
    if (!attachments.some(same)) onAttachments([...attachments, attachment]);
  }
  function pickAgent(name: string) {
    onDraft(`@${name} `);
    setTrigger(undefined);
    textarea.current?.focus();
  }
  async function addFiles(files: File[]) {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        onError(`${file.name} is larger than the 10 MB limit.`);
        continue;
      }
      send({
        type: 'attachImage',
        draftKey,
        name: file.name || 'Pasted image.png',
        data: await readFile(file),
      });
    }
  }
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
  const worktree = session ? session.cwd !== session.workspace : Boolean(choice.worktree);
  const blocked = !trusted || !api;
  return (
    <div
      className={`composer-area pt-2 px-6 pb-2.5 shrink-0 relative [&.top]:pt-3.5 max-[900px]:py-2 max-[900px]:px-3 [.question-dock+&]:pt-0 ${top ? 'top' : ''}`}
      data-mode={modeShown.mode}
    >
      <div className="relative max-w-[780px] m-auto">
        {menuOpen && trigger?.mark === '/' ? (
          <SkillMenu
            agent={agent}
            catalog={skills[agent]}
            query={trigger.query}
            below={Boolean(top)}
            onPick={(skill) =>
              attach({
                kind: 'skill',
                name: skill.name,
                ...(skill.path ? { path: skill.path } : {}),
              })
            }
            onManage={() => {
              removeToken();
              onManageSkills();
            }}
            onClose={() => setDismissed(trigger.start)}
            keyHandler={menuKeys}
          />
        ) : menuOpen && trigger ? (
          <ContextMenu
            trigger={trigger}
            results={contextResults}
            project={project}
            sessions={sessions}
            currentId={session?.id}
            below={Boolean(top)}
            leading={trigger.mark === '@' && !draft.slice(0, trigger.start).trim()}
            onAgent={pickAgent}
            onAttach={attach}
            onImages={() => {
              removeToken();
              send({ type: 'pickImages', draftKey });
            }}
            onClose={() => setDismissed(trigger.start)}
            keyHandler={menuKeys}
          />
        ) : null}
        <div
          data-agent={target ?? agent}
          className="composer border border-strong rounded-lg bg-raised max-w-[780px] m-auto focus-within:border-agent-edge [.question-dock+*_&]:relative [&_textarea]:w-full [&_textarea]:pt-2.5 [&_textarea]:px-3 [&_textarea]:pb-1 [&_textarea]:block [&_textarea]:text-[13px] [&_textarea]:leading-[1.55] [&_textarea]:resize-none [&_textarea]:field-sizing-content [&_textarea]:min-h-[52px] [&_textarea]:max-h-[40vh] [&_textarea]:overflow-y-auto [&_textarea:focus-visible]:outline-none in-[.composer-area.top]:[&_textarea]:min-h-24"
        >
          {session?.mode === 'ask' && session.status === 'completed' ? (
            <div className="flex items-center gap-2 px-2.5 pt-2 text-xs text-muted-foreground">
              <span className="flex-1">Ask is read-only.</span>
              <button
                type="button"
                className="cursor-pointer text-[var(--link)] bg-transparent p-0 text-xs hover:underline"
                onClick={() => {
                  selectMode('agent');
                  if (!draft.trim()) onDraft('Go ahead and make those changes.');
                  focusInput();
                }}
              >
                Build in Agent
              </button>
            </div>
          ) : null}
          {attachments.length ? (
            <div className="flex flex-wrap gap-1 pt-2 px-2.5 pb-0 in-[.user]:pt-0 in-[.user]:px-0 in-[.user]:pb-1.5">
              {attachments.map((item, index) => (
                <AttachmentChip
                  // biome-ignore lint/suspicious/noArrayIndexKey: attachments are unique and only append or remove
                  key={index}
                  attachment={item}
                  muted={missingSkills.includes(item)}
                  onRemove={() => onAttachments(attachments.filter((other) => other !== item))}
                />
              ))}
            </div>
          ) : null}
          <textarea
            ref={textarea}
            aria-label="Message your agent"
            rows={top ? 4 : 2}
            value={draft}
            placeholder={
              session
                ? busy
                  ? 'Draft your next message…'
                  : 'Plan, build, / for skills, @ for context'
                : 'Plan, build, / for skills, @ for context'
            }
            onChange={(event) => {
              onDraft(event.target.value);
              setDismissed(undefined);
              readTrigger(event.target);
            }}
            onSelect={(event) => readTrigger(event.currentTarget)}
            onBlur={() => setTrigger(undefined)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith('image/'),
              );
              if (!files.length) return;
              event.preventDefault();
              void addFiles(files);
            }}
            onKeyDown={(event) => {
              if (menuOpen && menuKeys.current?.(event)) {
                event.preventDefault();
                return;
              }
              if (event.key === 'Tab' && event.shiftKey && !modeLocked) {
                event.preventDefault();
                selectMode(nextMode(modeShown.mode));
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!noImages && !missingSkills.length && !needsPrompt) onSubmit();
              }
            }}
          />
          {missingSkills.length ? (
            <div className="mt-0.5 mx-2.5 text-[11.5px] text-warning" role="alert">
              {AGENT_LABELS[agent]} doesn’t have {missingSkills.map(attachmentLabel).join(', ')}.
              Remove it or switch agent.
            </div>
          ) : null}
          {noImages ? (
            <div className="mt-0.5 mx-2.5 text-[11.5px] text-warning" role="alert">
              This model can’t read images. Pick another model or remove the image.
            </div>
          ) : null}
          <div className="flex justify-between items-center gap-2 pt-1 px-2 pb-2">
            <div className="composer-controls flex items-center gap-0.5 min-w-0 flex-wrap max-[480px]:flex-wrap">
              <Menu
                label={
                  session?.provider === 'codex' && session.mode === 'auto' && !session.reportedMode
                    ? 'Auto requested'
                    : modeShown.label
                }
                icon={
                  <Icon
                    name={modeShown.mode ? MODE_ICONS[modeShown.mode] : 'agentMode'}
                    size={13}
                  />
                }
                ariaLabel={`Mode: ${modeShown.label}`}
                className="mode-chip text-muted-foreground in-data-[mode=plan]:bg-plan-tint in-data-[mode=plan]:text-plan in-data-[mode=plan]:enabled:hover:bg-plan-tint in-data-[mode=plan]:enabled:hover:text-plan"
                disabled={modeLocked}
                onClosed={focusInput}
                items={AGENT_MODES.map((item) => ({
                  key: item,
                  label: MODE_LABELS[item],
                  description: CAPABILITIES[agentTarget(agent).provider].modes[item],
                  icon: <Icon name={MODE_ICONS[item]} size={14} />,
                  selected: modeShown.mode === item,
                  onSelect: () => selectMode(item),
                }))}
              />
              <ModelSelector
                catalog={catalog}
                agent={agent}
                model={model}
                active={session?.activeModel}
                target={target}
                lockedAgent={Boolean(session)}
                effort={effort}
                efforts={efforts}
                onEffort={selectEffort}
                onSelect={selectModel}
                onRetry={() => send({ type: 'refreshModels' })}
                onClosed={focusInput}
              />
              <Menu
                label={`Thinking: ${THINKING_LABELS[thinking]}`}
                icon={<Icon name="brain" size={13} />}
                ariaLabel="Thinking"
                disabled={modeLocked}
                onClosed={focusInput}
                heading={support.reason || 'Thinking'}
                items={(
                  [
                    'default',
                    ...(support.on ? ['on'] : []),
                    ...(support.off ? ['off'] : []),
                  ] as Thinking[]
                ).map((value) => ({
                  key: value,
                  label: THINKING_LABELS[value],
                  selected: value === thinking,
                  onSelect: () => selectThinking(value),
                }))}
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <UsageIndicator
                session={session}
                onHandOff={session ? () => send({ type: 'handoff', id: session.id }) : undefined}
              />
              <button
                type="button"
                className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
                aria-label="Attach images"
                title="Attach images"
                disabled={blocked}
                onClick={() => send({ type: 'pickImages', draftKey })}
              >
                <Icon name="clip" />
              </button>
              {busy && !canDelegate ? (
                <button
                  type="button"
                  className="send-button bg-primary text-primary-foreground size-[26px] p-1 rounded-full shrink-0 enabled:hover:bg-accent-hover [&.stop]:bg-transparent [&.stop]:text-foreground [&.stop]:border-strong in-data-[mode=plan]:[&:not(.stop)]:bg-plan in-data-[mode=plan]:[&:not(.stop)]:text-plan-foreground in-data-[mode=plan]:enabled:hover:[&:not(.stop)]:bg-plan stop"
                  aria-label="Stop agent"
                  title="Stop agent"
                  onClick={() => session && send({ type: 'interrupt', id: session.id })}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button bg-primary text-primary-foreground size-[26px] p-1 rounded-full shrink-0 enabled:hover:bg-accent-hover [&.stop]:bg-transparent [&.stop]:text-foreground [&.stop]:border-strong in-data-[mode=plan]:[&:not(.stop)]:bg-plan in-data-[mode=plan]:[&:not(.stop)]:text-plan-foreground in-data-[mode=plan]:enabled:hover:[&:not(.stop)]:bg-plan"
                  aria-label="Send message"
                  title={
                    needsPrompt && target
                      ? `Add a prompt for ${AGENT_LABELS[target]}`
                      : canDelegate
                        ? `Run ${AGENT_LABELS[mention?.agent ?? 'codex']}`
                        : 'Send · Enter'
                  }
                  disabled={
                    !draft.trim() || blocked || noImages || missingSkills.length > 0 || needsPrompt
                  }
                  onClick={onSubmit}
                >
                  <Icon name="arrow" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="composer-caption flex items-center justify-between gap-3 text-muted-foreground text-[10.5px] max-w-[780px] mt-1.5 mx-auto mb-0 [&>span]:truncate max-[480px]:[&>span:last-child]:hidden">
        <Menu
          label={worktree ? 'Worktree' : 'Local'}
          icon={<Icon name="branch" size={12} />}
          ariaLabel={`Location: ${worktree ? 'worktree' : 'local checkout'}`}
          className="min-h-5 px-1 py-[3px] text-[10.5px]"
          onClosed={focusInput}
          heading="Where it works"
          items={
            session
              ? [
                  {
                    key: 'current',
                    label: worktree ? 'This worktree' : 'Local checkout',
                    description: session.cwd,
                    selected: true,
                    onSelect: () => {},
                  },
                  {
                    key: 'worktree',
                    label: 'Continue in a new worktree',
                    description: 'Opens a linked thread from committed HEAD',
                    onSelect: () => send({ type: 'worktree', id: session.id }),
                  },
                ]
              : [
                  {
                    key: 'local',
                    label: 'Local checkout',
                    description: 'Works in your open folder',
                    selected: !choice.worktree,
                    onSelect: () => onChoice({ ...choice, worktree: false }),
                  },
                  {
                    key: 'worktree',
                    label: 'New worktree',
                    description: 'Starts from committed HEAD',
                    selected: Boolean(choice.worktree),
                    onSelect: () => onChoice({ ...choice, worktree: true }),
                  },
                ]
          }
        />
        {nudge ? (
          <output className="inline-flex items-center gap-[5px] px-2 py-px border border-subtle rounded-full text-[10.5px] text-muted-foreground [&_kbd]:text-[10.5px] [&_kbd]:text-faint">
            {nudge.kind === 'plan' ? (
              <button
                type="button"
                className="cursor-pointer bg-transparent p-0 text-inherit"
                onClick={() => selectMode('plan')}
              >
                {nudge.text} <kbd>⇧Tab</kbd>
              </button>
            ) : (
              <span>{nudge.text}</span>
            )}
            {nudge.kind === 'handoff' && session ? (
              <button
                type="button"
                className="cursor-pointer bg-transparent p-0 text-[var(--link)] hover:underline"
                onClick={() => send({ type: 'handoff', id: session.id })}
              >
                Hand off
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`Dismiss: ${nudge.text}`}
              className="cursor-pointer bg-transparent p-0 opacity-60 hover:opacity-100"
              onClick={() => onDismissNudge(nudge.key)}
            >
              <Icon name="close" size={10} />
            </button>
          </output>
        ) : (
          <span className="self-center">Enter to send · ⇧Tab to change mode</span>
        )}
      </div>
    </div>
  );
}
