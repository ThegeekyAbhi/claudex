import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type BuildChoice, catalogFor, setProfiles } from '../../../../shared/model';
import type { PagePlan } from '../../../../shared/protocol/pages';
import { Icon } from '../../../components/icons';
import { EffortMenu } from '../../models/effort-menu';
import { ModelSelector } from '../../models/model-selector';
import { MENU_CONTENT, MENU_ITEM, MenuRow, QUIET, TINTED } from '../../plan/build-controls';
import { buildOptions } from '../../plan/plan-options';
import { post } from '../shared/page-bridge';

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const BUILD_KEY = MAC ? '⌘↵' : 'Ctrl↵';

const STATUS: Record<PagePlan['status'], string> = {
  drafting: 'Drafting',
  ready: 'Ready to build',
  incomplete: 'Unfinished: the turn ended first',
  approved: 'Built',
};

/**
 * At the top of a page that is a thread's plan: its state, and the same build choices as the
 * chat's plan dock. Implement in this thread, or start a new chat on any agent and model. Both go
 * through the chat's own checks; the bar only says what the host reports.
 */
export function PlanBar({ plan, flush }: { plan: PagePlan; flush: () => void }) {
  // The model picker names agents from the shared list; the page learns it from the plan.
  setProfiles(plan.profiles);
  const [fresh, setFresh] = useState(false);
  const [choice, setChoice] = useState<BuildChoice>({ agent: plan.agent });
  const [pending, setPending] = useState(false);
  const freshRow = useRef<HTMLDivElement>(null);
  // Every state from the host is the truth again, whether the build started or failed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new plan state clears the wait
  useEffect(() => setPending(false), [plan]);
  useEffect(() => {
    if (fresh) freshRow.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [fresh]);

  const options = buildOptions(plan.agent).filter(
    (option) => option.id === 'auto' || plan.manualAllowed,
  );
  const usual = options[0];
  const agent = choice.agent ?? plan.agent;
  const buildable = plan.status === 'ready' && plan.canBuild && !pending;

  function send(
    action: Omit<
      Extract<Parameters<typeof post>[0], { type: 'pagePlanBuild' }>,
      'type' | 'threadId'
    >,
  ) {
    if (!buildable) return;
    flush();
    setPending(true);
    post({ type: 'pagePlanBuild', threadId: plan.threadId, ...action });
  }
  const build = (approvals: 'auto' | 'manual') => send({ approvals });
  const start = () => send({ ...choice, agent });

  // ⌘/Ctrl+Enter takes the row you're on, unless you're typing in the plan itself.
  const latest = useRef(() => {});
  latest.current = () => (fresh ? start() : build('auto'));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      const typing = (event.target as Element | null)?.closest?.(
        '.ProseMirror, input, textarea, [contenteditable="true"]',
      );
      if (typing) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (plan.status === 'drafting') return null;
  const tone =
    plan.status === 'ready'
      ? 'text-success'
      : plan.status === 'incomplete'
        ? 'text-warning'
        : 'text-muted-foreground';
  const status = pending
    ? 'Starting…'
    : plan.status === 'ready' && !plan.canBuild
      ? 'Waiting for the thread'
      : STATUS[plan.status];
  const openThread = () => post({ type: 'openChat', id: plan.threadId });
  const efforts =
    catalogFor(plan.catalog, agent).models.find((item) => item.id === choice.model)?.efforts ?? [];

  return (
    <section
      aria-label="Plan"
      className="plan-bar sticky top-0 z-20 -mx-3 mb-6 flex min-h-11 flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-subtle bg-canvas px-3 py-1.5 text-[12px] text-muted-foreground"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && fresh) {
          event.preventDefault();
          setFresh(false);
        }
      }}
    >
      {plan.status === 'ready' && fresh ? (
        <div ref={freshRow} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
          <ModelSelector
            catalog={plan.catalog}
            agent={agent}
            model={choice.model}
            side="bottom"
            accounts={false}
            onSelect={(next) => setChoice(next)}
          />
          <EffortMenu
            effort={choice.effort}
            efforts={efforts}
            side="bottom"
            onEffort={(effort) => setChoice({ ...choice, effort })}
          />
          <span data-mode="auto" className="ml-auto flex">
            <button
              type="button"
              disabled={!buildable}
              className={`${TINTED} rounded-md px-2.5 disabled:opacity-50`}
              title={`A fresh thread starts with only the plan · ${BUILD_KEY}`}
              onClick={start}
            >
              <Icon name="autoMode" size={13} />
              Start in Auto
              <kbd className="font-sans text-[10.5px] font-normal opacity-60 max-[560px]:hidden">
                {BUILD_KEY}
              </kbd>
            </button>
          </span>
        </div>
      ) : (
        <>
          <span data-mode="plan" className="flex shrink-0 text-mode">
            <Icon name="plan" size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">
              {plan.status === 'ready' ? 'Plan ready' : 'Plan'}
            </span>{' '}
            · {plan.model ?? plan.agentLabel} · <span className={tone}>{status}</span>
          </span>
          {plan.status === 'ready' && usual ? (
            <span data-mode="auto" className="flex shrink-0 overflow-hidden rounded-md">
              <button
                type="button"
                disabled={!buildable}
                className={`${TINTED} pr-2 pl-2.5 disabled:opacity-50`}
                aria-label={usual.action}
                aria-keyshortcuts={MAC ? 'Meta+Enter' : 'Control+Enter'}
                title={`${usual.hint} · ${BUILD_KEY}`}
                onClick={() => build('auto')}
              >
                <Icon name={usual.icon} size={13} />
                <span className="max-[480px]:hidden">{usual.action}</span>
                <span className="hidden max-[480px]:inline">Implement</span>
                <kbd className="font-sans text-[10.5px] font-normal opacity-60 max-[560px]:hidden">
                  {BUILD_KEY}
                </kbd>
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
                  className={MENU_CONTENT}
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  collisionPadding={8}
                >
                  {options.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      className={MENU_ITEM}
                      disabled={!buildable}
                      onSelect={() => build(option.id)}
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
                      hint="A fresh thread with only the plan, on any agent and model."
                    />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-1 my-1 h-px bg-subtle" />
                  <DropdownMenuItem className={MENU_ITEM} onSelect={openThread}>
                    <MenuRow
                      icon="plan"
                      label="Keep planning in chat"
                      hint="Open the thread to refine the plan with the agent."
                    />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={MENU_ITEM}
                    onSelect={() => post({ type: 'pageOpenText' })}
                  >
                    <MenuRow
                      icon="file"
                      label="Open as text"
                      hint="The plan's Markdown in a text editor."
                    />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          ) : (
            <button type="button" onClick={openThread} className={QUIET}>
              {plan.status === 'approved' ? 'Open thread' : 'Continue in chat'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
