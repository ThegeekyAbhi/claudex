import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type AgentKind,
  agentKind,
  type BuildChoice,
  type Catalog,
  catalogFor,
  profileLabel,
  profileProvider,
  type Session,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon, type IconName } from '../../components/icons';
import { Menu } from '../../components/menus';
import { EffortMenu } from '../models/effort-menu';
import { ModelSelector } from '../models/model-selector';
import { planTitle } from './plan-title';

export type BuildApprovals = 'auto' | 'manual';
export const BuildContext = createContext<{
  catalog: Catalog;
  sessions: Session[];
  /** How you last built a plan, offered first next time. */
  approvals?: BuildApprovals;
  onApprovals?(approvals: BuildApprovals): void;
} | null>(null);
/** The shortcut as each system writes it: ⌘ on a Mac, Ctrl elsewhere. */
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const BUILD_KEY = MAC ? '⌘↵' : 'Ctrl↵';

interface BuildOption {
  id: BuildApprovals;
  label: string;
  /** The primary button's wording when this is your usual way to build. */
  action: string;
  hint: string;
  icon: IconName;
}
/**
 * What each CLI offers when a plan is ready, and nothing more: Claude Code can implement in Auto
 * or ask before each edit; Codex implements in Auto. Either can start a new chat or keep planning.
 */
export function buildOptions(agent: AgentKind): BuildOption[] {
  const name = profileLabel(agent);
  return [
    {
      id: 'auto',
      label: 'Implement in Auto',
      action: 'Implement in Auto',
      hint: `${name} makes the changes and handles approvals itself.`,
      icon: 'autoMode',
    },
    ...(profileProvider(agent) === 'claude'
      ? [
          {
            id: 'manual' as const,
            label: 'Approve each edit',
            action: 'Implement, approving edits',
            hint: 'Every edit and command waits for you.',
            icon: 'approveEdits' as const,
          },
        ]
      : []),
  ];
}

/** Recently used agent and model pairs, for starting the new chat quickly. */
function useRecent(): Session[] {
  const context = useContext(BuildContext);
  return (
    context?.sessions
      .filter(
        (item) =>
          !item.model ||
          catalogFor(context.catalog, agentKind(item)).models.some(
            (model) => model.id === item.model,
          ),
      )
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (other) => agentKind(other) === agentKind(item) && other.model === item.model,
          ) === index,
      )
      .slice(0, 4) ?? []
  );
}

/** Brings the plan back into view, for a last look before deciding. */
function revealPlan() {
  const cards = document.querySelectorAll<HTMLElement>('.plan-card');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  cards[cards.length - 1]?.scrollIntoView({
    block: 'start',
    behavior: reduced ? 'auto' : 'smooth',
  });
}

const RING =
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus,var(--accent))]';
const QUIET = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground ${RING}`;
/** Tinted like the mode chip: Auto's colour inside data-mode="auto", plain otherwise. */
const TINTED = `inline-flex h-7 items-center gap-1.5 text-[12px] font-medium ${RING} focus-visible:ring-inset bg-muted text-foreground enabled:hover:bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] in-data-[mode]:bg-mode-tint in-data-[mode]:text-mode in-data-[mode]:enabled:hover:bg-[color-mix(in_srgb,var(--mode)_24%,transparent)]`;
const MENU_ITEM =
  'flex w-full cursor-pointer select-none items-start gap-2.5 rounded-[5px] px-2 py-1.5 text-left outline-none data-highlighted:bg-muted';

function MenuRow({
  icon,
  label,
  hint,
  trail,
}: {
  icon: IconName;
  label: string;
  hint: string;
  trail?: ReactNode;
}) {
  return (
    <>
      <span className="mt-px flex shrink-0 text-muted-foreground">
        <Icon name={icon} size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[12px]">{label}</span>
        <small className="text-[11px] leading-[1.4] text-muted-foreground">{hint}</small>
      </span>
      {trail}
    </>
  );
}

/**
 * Your answer to a ready plan, docked on the message box. The message box holds your notes:
 * send them to keep planning, or implement and they go along with the plan.
 */
export function PlanOptions({
  session,
  notes = '',
  onNotesUsed,
}: {
  session: Session;
  /** What you've typed in the message box, sent along as notes when you implement. */
  notes?: string;
  onNotesUsed?(): void;
}) {
  const agent = agentKind(session);
  const context = useContext(BuildContext);
  const options = buildOptions(agent);
  const usual =
    options.find((option) => option.id === context?.approvals) ?? (options[0] as BuildOption);
  const [fresh, setFresh] = useState(false);
  const [choice, setChoice] = useState<BuildChoice>({ agent });
  const recent = useRecent();
  const selectedAgent = choice.agent ?? agent;
  const name = profileLabel(agent);
  const waiting = session.approval?.kind === 'plan';
  const hasNotes = Boolean(notes.trim());
  const withNotes = hasNotes ? { notes } : {};
  const title = planTitle(session.plan?.text ?? '');
  const freshRow = useRef<HTMLDivElement>(null);
  // The choice already sent, and the thread state it was sent in: a double click doesn't ask twice,
  // while another choice, different notes, or the same one once the thread moves on, still can.
  const submitted = useRef<{ id: string; state: string } | null>(null);
  const state = `${session.status}|${session.approval?.id ?? ''}|${session.mode ?? ''}|${notes}`;
  function repeat(id: string): boolean {
    if (submitted.current?.id === id && submitted.current.state === state) return true;
    submitted.current = { id, state };
    return false;
  }
  function used() {
    if (hasNotes) onNotesUsed?.();
  }
  function build(option: BuildOption) {
    if (repeat(option.id)) return;
    if (option.id !== (context?.approvals ?? 'auto')) context?.onApprovals?.(option.id);
    send({
      type: 'buildPlan',
      id: session.id,
      ...(option.id === 'manual' ? { approvals: 'manual' as const } : {}),
      ...withNotes,
    });
    used();
  }
  function start() {
    if (repeat('start')) return;
    send({ type: 'buildPlan', id: session.id, ...choice, agent: selectedAgent, ...withNotes });
    used();
  }
  function keepPlanning() {
    send({ type: 'keepPlanning', id: session.id, ...(hasNotes ? { feedback: notes } : {}) });
    used();
  }
  // ⌘/Ctrl+Enter takes the highlighted way forward, unless you're writing in the message box,
  // where it sends what you wrote.
  const latest = useRef(() => {});
  latest.current = () => (fresh ? start() : build(usual));
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      const box = document.querySelector<HTMLElement>('.composer-input');
      if (box?.dataset.value?.trim()) return;
      event.preventDefault();
      latest.current();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (fresh) freshRow.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [fresh]);
  const notesTag = hasNotes ? (
    <span className="rounded-sm bg-[color-mix(in_srgb,currentColor_16%,transparent)] px-1 text-[10.5px] font-normal">
      + notes
    </span>
  ) : null;
  return (
    <div className="plan-dock relative shrink-0 px-6 pt-2 pb-0 max-[900px]:px-3">
      <fieldset
        aria-label="Plan choices"
        className="plan-options mx-auto -mb-2.5 min-w-0 max-w-[780px] rounded-t-lg border border-strong bg-canvas pb-2.5"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && fresh) {
            event.preventDefault();
            setFresh(false);
          }
        }}
      >
        {fresh ? (
          <div
            ref={freshRow}
            className="flex min-h-10 flex-wrap items-center gap-1 py-1 pr-1.5 pl-1 text-[12px]"
          >
            <button
              type="button"
              className={QUIET}
              aria-label="Back to plan choices"
              title="Back · Esc"
              onClick={() => setFresh(false)}
            >
              <span className="flex rotate-180">
                <Icon name="chevron" size={13} />
              </span>
              <span className="font-medium text-foreground">New chat</span>
            </button>
            {context ? (
              <>
                <ModelSelector
                  catalog={context.catalog}
                  agent={selectedAgent}
                  model={choice.model}
                  onSelect={(next) => setChoice(next)}
                  onRetry={() => send({ type: 'refreshModels' })}
                />
                <EffortMenu
                  effort={choice.effort}
                  efforts={
                    catalogFor(context.catalog, selectedAgent).models.find(
                      (item) => item.id === choice.model,
                    )?.efforts ?? []
                  }
                  onEffort={(effort) => setChoice({ ...choice, effort })}
                />
                {recent.length ? (
                  <Menu
                    label="Recent"
                    icon={<Icon name="history" size={13} />}
                    ariaLabel="Recently used models"
                    heading="Recently used"
                    items={recent.map((item) => ({
                      key: item.id,
                      label: `${profileLabel(agentKind(item))} · ${item.model ?? 'Default'}`,
                      selected: agentKind(item) === selectedAgent && item.model === choice.model,
                      onSelect: () =>
                        setChoice({
                          agent: agentKind(item),
                          model: item.model,
                          effort: item.effort,
                        }),
                    }))}
                  />
                ) : null}
              </>
            ) : null}
            <span data-mode="auto" className="ml-auto flex">
              <button
                type="button"
                className={`${TINTED} rounded-md px-2.5`}
                title={`A fresh thread starts with only the plan · ${BUILD_KEY}`}
                onClick={start}
              >
                <Icon name="autoMode" size={13} />
                Start in Auto
                {notesTag}
              </button>
            </span>
          </div>
        ) : (
          <div className="flex min-h-10 items-center gap-1.5 py-1 pr-1.5 pl-3 text-[12px]">
            <span data-mode="plan" className="flex shrink-0 text-mode">
              <Icon name="plan" size={14} />
            </span>
            <strong className="shrink-0 font-medium text-foreground">Plan ready</strong>
            <button
              type="button"
              className={`min-w-0 truncate rounded px-1 text-left text-faint enabled:hover:text-foreground ${RING}`}
              title={title ? `Review the plan: ${title}` : 'Review the plan'}
              aria-label="Review the plan"
              onClick={revealPlan}
            >
              {title || 'Review'}
            </button>
            <span className="flex-1" />
            {waiting ? (
              <button
                type="button"
                className={`${QUIET} max-[420px]:hidden`}
                title={
                  hasNotes
                    ? `Your message goes back to ${name} as feedback`
                    : `${name} stays in Plan mode and waits for your feedback`
                }
                onClick={keepPlanning}
              >
                Keep planning
              </button>
            ) : null}
            <span
              data-mode={usual.id === 'auto' ? 'auto' : undefined}
              className="flex shrink-0 overflow-hidden rounded-md"
            >
              <button
                type="button"
                className={`${TINTED} pr-2 pl-2.5`}
                aria-label={usual.action}
                aria-keyshortcuts={MAC ? 'Meta+Enter' : 'Control+Enter'}
                title={`${usual.hint}${hasNotes ? ' Your message goes along as notes.' : ''} · ${BUILD_KEY}`}
                onClick={() => build(usual)}
              >
                <Icon name={usual.icon} size={13} />
                <span className="max-[480px]:hidden">{usual.action}</span>
                <span className="hidden max-[480px]:inline">Implement</span>
                {notesTag ?? (
                  <kbd className="font-sans text-[10.5px] font-normal opacity-60 max-[560px]:hidden">
                    {BUILD_KEY}
                  </kbd>
                )}
              </button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={`${TINTED} w-6 justify-center border-l border-[color-mix(in_srgb,currentColor_22%,transparent)]`}
                    aria-label="More ways to continue"
                  >
                    <Icon name="chevronDown" size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="z-40 w-75 max-w-[calc(100vw-16px)] rounded-lg border border-strong bg-overlay p-1 text-foreground shadow-md animate-menu-in [transform-origin:var(--radix-dropdown-menu-content-transform-origin)] focus:outline-none motion-reduce:animate-none"
                  side="top"
                  align="end"
                  sideOffset={6}
                  collisionPadding={8}
                >
                  {options.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      className={MENU_ITEM}
                      onSelect={() => build(option)}
                    >
                      <MenuRow
                        icon={option.icon}
                        label={option.label}
                        hint={option.hint}
                        trail={
                          option.id === usual.id ? (
                            <kbd className="mt-px font-sans text-[10.5px] text-faint">
                              {BUILD_KEY}
                            </kbd>
                          ) : null
                        }
                      />
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem className={MENU_ITEM} onSelect={() => setFresh(true)}>
                    <MenuRow
                      icon="plus"
                      label="In a new chat…"
                      hint="A fresh thread with only the plan, on any agent."
                    />
                  </DropdownMenuItem>
                  {waiting ? (
                    <>
                      <DropdownMenuSeparator className="mx-1 my-1 h-px bg-subtle" />
                      <DropdownMenuItem className={MENU_ITEM} onSelect={keepPlanning}>
                        <MenuRow
                          icon="plan"
                          label="Keep planning"
                          hint={`Your message goes back to ${name} as feedback.`}
                        />
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
        )}
      </fieldset>
    </div>
  );
}
