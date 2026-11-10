import { type ReactElement, useState } from 'react';
import {
  attachmentLabel,
  canBuildPlan,
  nextMode,
  profileLabel,
  profileProvider,
  skillsFor,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import { AttachmentChip, ContextMenu } from '../attachments/context-menu';
import { SkillMenu } from '../skills/skill-menu';
import { UsageIndicator } from '../usage/usage-indicator';
import { ComposerCaption } from './caption';
import { ComposerEditor } from './composer-editor';
import { ComposerControls } from './controls';
import { ImageStrip } from './image-strip';
import type { ComposerProps } from './types';
import { useComposer } from './use-composer';

export function Composer(props: ComposerProps): ReactElement {
  const [continuing, setContinuing] = useState(false);
  const {
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
    top,
    contextResults,
    onDraft,
    onChoice,
    onDismissNudge,
    onSubmit,
    preferences,
  } = props;
  const {
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
    textarea,
    trigger,
    setTrigger,
    setDismissed,
    menuKeys,
    menuFrame,
    anchor,
    menuOpen,
    readTrigger,
    removeToken,
    attach,
    removeAttachment,
    pickAgent,
    addFiles,
  } = useComposer(props);
  const contextAttachments = attachments.filter(
    (item) => item.kind !== 'file' && item.kind !== 'folder' && item.kind !== 'image',
  );
  return (
    <div
      className={`composer-area pt-2 px-6 pb-2.5 shrink-0 relative [&.top]:pt-3.5 max-[900px]:py-2 max-[900px]:px-3 [.question-dock+&]:pt-0 [.plan-dock+&]:pt-0 ${top ? 'top' : ''}`}
      data-mode={modeShown.mode}
    >
      {continuing && session ? (
        <section
          className="mx-auto mb-2 max-w-[780px] rounded-lg border border-strong bg-surface p-3"
          aria-label="Continue with another agent"
        >
          <div className="flex items-center justify-between text-xs">
            <strong>Continue with…</strong>
            <button
              type="button"
              onClick={() => setContinuing(false)}
              aria-label="Close continuation"
            >
              ×
            </button>
          </div>
          <p className="my-2 text-xs text-muted-foreground">
            Keep this chat and review the context before continuing. Your next message starts a new
            provider session.
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(catalog)
              .filter(([id, value]) => id !== agent && value.status === 'ready')
              .map(([id]) => (
                <button
                  key={id}
                  type="button"
                  className="rounded-md border border-subtle px-3 py-1.5 text-xs hover:bg-raised"
                  onClick={() => {
                    send({ type: 'continueChat', id: session.id, agent: id });
                    setContinuing(false);
                  }}
                >
                  {profileLabel(id)}
                </button>
              ))}
            {!Object.entries(catalog).some(
              ([id, value]) => id !== agent && value.status === 'ready',
            ) ? (
              <span className="text-xs text-muted-foreground">
                No other agent is ready. Check your installed agents and accounts.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
      <div ref={menuFrame} className="relative max-w-[780px] m-auto">
        {menuOpen && anchor && trigger?.mark === '/' ? (
          <SkillMenu
            agent={agent}
            catalog={skillsFor(skills, agent)}
            query={trigger.query}
            anchor={anchor}
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
        ) : menuOpen && anchor && trigger ? (
          <ContextMenu
            trigger={trigger}
            results={contextResults}
            project={project}
            sessions={sessions}
            currentId={session?.id}
            anchor={anchor}
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
          data-agent={profileProvider(agent)}
          className="composer @container border border-composer-edge rounded-lg bg-raised max-w-[780px] m-auto focus-within:border-agent-edge [.question-dock+*_&]:relative [.plan-dock+*_&]:relative"
        >
          <ImageStrip
            images={attachments.filter((item) => item.kind === 'image')}
            onRemove={removeAttachment}
          />
          {contextAttachments.length ? (
            <div className="flex flex-wrap items-start gap-1 pt-2 px-2.5 pb-0 in-[.user]:pt-0 in-[.user]:px-0 in-[.user]:pb-1.5">
              {contextAttachments.map((item, index) => (
                <AttachmentChip
                  // biome-ignore lint/suspicious/noArrayIndexKey: attachments are unique and only append or remove
                  key={index}
                  attachment={item}
                  muted={missingSkills.includes(item)}
                  onRemove={() => removeAttachment(item)}
                  onOpen={
                    item.kind === 'thread' && item.history
                      ? () =>
                          send({
                            type: 'previewContext',
                            id: item.id,
                            history: item.history ?? 'recent',
                            ...(session ? { targetId: session.id } : {}),
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          ) : null}
          <ComposerEditor
            ref={textarea}
            aria-label="Message your agent"
            value={draft}
            attachments={attachments}
            draftKey={draftKey}
            onAttachments={props.onAttachments}
            onImages={(files) => void addFiles(files)}
            placeholder={
              session
                ? busy && session.approval?.kind !== 'plan'
                  ? 'Draft your next message…'
                  : canBuildPlan(session)
                    ? 'Refine the plan, or add notes for the build…'
                    : 'Plan, build, / for skills, @ for context'
                : 'Plan, build, / for skills, @ for context'
            }
            onChange={(value) => {
              onDraft(value);
              setDismissed(undefined);
            }}
            onSelect={readTrigger}
            onBlur={() => setTrigger(undefined)}
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
              {profileLabel(agent)} doesn’t have {missingSkills.map(attachmentLabel).join(', ')}.
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
              <ComposerControls
                catalog={catalog}
                session={session}
                preferences={preferences}
                agent={agent}
                model={model}
                effort={effort}
                modeLocked={modeLocked}
                thinking={thinking}
                support={support}
                modeShown={modeShown}
                efforts={efforts}
                target={target}
                focusInput={focusInput}
                menuSide={menuSide}
                selectModel={selectModel}
                selectEffort={selectEffort}
                selectThinking={selectThinking}
                selectMode={selectMode}
                guide={guide}
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <UsageIndicator
                session={session}
                onHandOff={session ? () => setContinuing(true) : undefined}
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
                  className="send-button bg-primary text-primary-foreground size-[26px] p-1 rounded-full shrink-0 enabled:hover:bg-accent-hover [&.stop]:bg-transparent [&.stop]:text-foreground [&.stop]:border-strong in-data-[mode]:[&:not(.stop)]:bg-mode in-data-[mode]:[&:not(.stop)]:text-mode-foreground in-data-[mode]:enabled:hover:[&:not(.stop)]:bg-mode stop"
                  aria-label="Stop agent"
                  title="Stop agent"
                  onClick={() => session && send({ type: 'interrupt', id: session.id })}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button bg-primary text-primary-foreground size-[26px] p-1 rounded-full shrink-0 enabled:hover:bg-accent-hover [&.stop]:bg-transparent [&.stop]:text-foreground [&.stop]:border-strong in-data-[mode]:[&:not(.stop)]:bg-mode in-data-[mode]:[&:not(.stop)]:text-mode-foreground in-data-[mode]:enabled:hover:[&:not(.stop)]:bg-mode"
                  aria-label="Send message"
                  title={
                    needsPrompt && target
                      ? `Add a prompt for ${profileLabel(target)}`
                      : canDelegate
                        ? `Run ${profileLabel(mention?.agent ?? 'codex')}`
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
      <ComposerCaption
        onContinue={() => setContinuing(true)}
        session={session}
        choice={choice}
        onChoice={onChoice}
        onDismissNudge={onDismissNudge}
        nudge={nudge}
        focusInput={focusInput}
        menuSide={menuSide}
        selectMode={selectMode}
        worktree={worktree}
      />
    </div>
  );
}
