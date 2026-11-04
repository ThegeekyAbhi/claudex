import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AGENT_LABELS,
  type AgentKind,
  type AgentMode,
  type Attachment,
  agentKind,
  type Catalog,
  parseMention,
  type Session,
} from '../model';
import { api, type ComposeChoice, send } from './bridge';
import {
  AttachmentChip,
  ContextMenu,
  type ContextResults,
  requestContext,
  type Trigger,
  triggerAt,
} from './context-menu';
import { Icon } from './icons';
import { Menu, ModelSelector } from './model-selector';
import { UsageIndicator } from './usage-indicator';

function modelOption(catalog: Catalog, agent: AgentKind, model?: string) {
  const models = catalog[agent].models;
  return (
    (model ? models.find((item) => item.id === model) : undefined) ??
    models.find((item) => item.isDefault) ??
    (model ? undefined : models[0])
  );
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
export function Composer({
  catalog,
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
  onSubmit,
  onError,
}: {
  catalog: Catalog;
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
  const mode: AgentMode = (session ? session.mode : choice.mode) ?? 'agent';
  const efforts = effortsFor(catalog, agent, model);
  const mention = parseMention(draft);
  const canDelegate = Boolean(session && mention && !session.observed);
  const menuOpen = Boolean(trigger) && dismissed !== trigger?.start;
  const noImages =
    attachments.some((item) => item.kind === 'image') &&
    modelOption(catalog, mention?.agent ?? agent, mention ? undefined : model)?.images === false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusing follows a change of thread
  useEffect(() => {
    textarea.current?.focus();
  }, [focusKey]);
  const query = trigger?.query;
  // Results are searched by the host, a moment after typing settles.
  useEffect(() => {
    if (query === undefined || !menuOpen) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => requestContext(id, query), query ? 80 : 0);
    return () => clearTimeout(timer);
  }, [query, menuOpen]);
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
    else onChoice({ ...choice, agent: next.agent, model: next.model, effort: nextEffort });
  }
  function selectEffort(next?: string) {
    if (session)
      send({ type: 'setModel', id: session.id, model: model ?? null, effort: next ?? null });
    else onChoice({ ...choice, effort: next });
  }
  function selectMode(next: AgentMode) {
    if (session) send({ type: 'setMode', id: session.id, mode: next });
    else onChoice({ ...choice, mode: next });
  }
  const worktree = session ? session.cwd !== session.workspace : Boolean(choice.worktree);
  const blocked = !trusted || !api;
  return (
    <div className={`composer-area ${top ? 'top' : ''}`} data-mode={mode}>
      <div className="composer-anchor">
        {menuOpen && trigger ? (
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
        <div className="composer">
          {attachments.length ? (
            <div className="attachment-row">
              {attachments.map((item, index) => (
                <AttachmentChip
                  // biome-ignore lint/suspicious/noArrayIndexKey: attachments are unique and only append or remove
                  key={index}
                  attachment={item}
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
                  ? 'Draft your next message, or @ to add context…'
                  : 'Ask for a change, or @ to add context…'
                : `Ask ${AGENT_LABELS[agent]} to build something, or @ to add context…`
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
              if (event.key === 'Tab' && event.shiftKey && !busy) {
                event.preventDefault();
                selectMode(mode === 'plan' ? 'agent' : 'plan');
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!noImages) onSubmit();
              }
            }}
          />
          {noImages ? (
            <div className="composer-warning" role="alert">
              This model can’t read images. Pick another model or remove the image.
            </div>
          ) : null}
          <div className="composer-footer">
            <div className="composer-controls">
              <Menu
                label={mode === 'plan' ? 'Plan' : 'Agent'}
                icon={<Icon name={mode === 'plan' ? 'plan' : 'agentMode'} size={13} />}
                ariaLabel={`Mode: ${mode === 'plan' ? 'Plan' : 'Agent'}`}
                className="mode-chip"
                disabled={busy}
                onClosed={focusInput}
                items={[
                  {
                    key: 'agent',
                    label: 'Agent',
                    description: 'Reads, edits, and runs commands, asking as your CLI requires',
                    icon: <Icon name="agentMode" size={14} />,
                    selected: mode === 'agent',
                    onSelect: () => selectMode('agent'),
                  },
                  {
                    key: 'plan',
                    label: 'Plan',
                    description: 'Researches and writes a plan before changing anything',
                    icon: <Icon name="plan" size={14} />,
                    selected: mode === 'plan',
                    onSelect: () => selectMode('plan'),
                  },
                ]}
              />
              <ModelSelector
                catalog={catalog}
                agent={agent}
                model={model}
                active={session?.activeModel}
                lockedAgent={Boolean(session)}
                effort={effort}
                efforts={efforts}
                onEffort={selectEffort}
                onSelect={selectModel}
                onRetry={() => send({ type: 'refreshModels' })}
                onClosed={focusInput}
              />
            </div>
            <div className="composer-send">
              <UsageIndicator
                usage={session?.usage}
                onHandOff={session ? () => send({ type: 'handoff', id: session.id }) : undefined}
              />
              <button
                type="button"
                className="icon-button"
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
                  className="send-button stop"
                  aria-label="Stop agent"
                  title="Stop agent"
                  onClick={() => session && send({ type: 'interrupt', id: session.id })}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  aria-label="Send message"
                  title={
                    canDelegate ? `Run ${AGENT_LABELS[mention?.agent ?? 'codex']}` : 'Send · Enter'
                  }
                  disabled={!draft.trim() || blocked || noImages}
                  onClick={onSubmit}
                >
                  <Icon name="arrow" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="composer-caption">
        <Menu
          label={worktree ? 'Worktree' : 'Local'}
          icon={<Icon name="branch" size={12} />}
          ariaLabel={`Location: ${worktree ? 'worktree' : 'local checkout'}`}
          className="caption-chip"
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
        {!session && mode === 'agent' ? (
          <button type="button" className="plan-hint" onClick={() => selectMode('plan')}>
            Try Plan Mode <kbd>⇧Tab</kbd>
          </button>
        ) : (
          <span className="caption-hint">
            {mode === 'plan' ? 'Plan mode · ⇧Tab for Agent' : 'Enter to send · ⇧Tab for Plan'}
          </span>
        )}
      </div>
    </div>
  );
}
