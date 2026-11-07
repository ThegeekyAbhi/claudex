import { createContext, useContext, useEffect, useRef, useState } from 'react';
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
import { Button } from '../../components/ui/button';
import { EffortMenu } from '../models/effort-menu';
import { ModelSelector } from '../models/model-selector';

export const BuildContext = createContext<{ catalog: Catalog; sessions: Session[] } | null>(null);
/** The shortcut as each system writes it: ⌘ on a Mac, Ctrl elsewhere. */
const BUILD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl ↵';

type Choice = 'auto' | 'manual' | 'new' | 'keep';
interface Option {
  id: Choice;
  label: string;
  hint: string;
}
/**
 * What each CLI offers when a plan is ready, and nothing more: Claude Code can implement in Auto or
 * ask before each edit, start fresh, or keep planning; Codex can implement or stay in Plan mode.
 */
export function planOptions(agent: AgentKind): Option[] {
  const name = profileLabel(agent);
  const claude = profileProvider(agent) === 'claude';
  return [
    {
      id: 'auto',
      label: 'Yes, implement in Auto',
      hint: `${name} makes the changes and reviews approvals itself.`,
    },
    ...(claude
      ? [
          {
            id: 'manual' as const,
            label: 'Yes, approve each edit',
            hint: 'Every edit and command waits for you.',
          },
        ]
      : []),
    { id: 'new', label: 'Yes, in a new chat', hint: 'A fresh thread starts with only the plan.' },
    { id: 'keep', label: 'No, keep planning', hint: `Your notes go back to ${name}.` },
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

/** Your answer to a ready plan, with optional notes, the way the CLIs ask for it. */
export function PlanOptions({ session }: { session: Session }) {
  const agent = agentKind(session);
  const context = useContext(BuildContext);
  const options = planOptions(agent);
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Choice>('auto');
  const submitted = useRef(false);
  const [fresh, setFresh] = useState(false);
  const [choice, setChoice] = useState<BuildChoice>({ agent });
  const [hint, setHint] = useState('');
  const notesBox = useRef<HTMLTextAreaElement>(null);
  const recent = useRecent();
  const selectedAgent = choice.agent ?? agent;
  const name = profileLabel(agent);
  const waiting = session.approval?.kind === 'plan';
  const withNotes = notes.trim() ? { notes } : {};
  function pick(id: Choice) {
    if (submitted.current) return;
    if (id !== 'new' && !(id === 'keep' && !notes.trim())) submitted.current = true;
    setHint('');
    if (id === 'auto') send({ type: 'buildPlan', id: session.id, ...withNotes });
    else if (id === 'manual')
      send({ type: 'buildPlan', id: session.id, approvals: 'manual', ...withNotes });
    else if (id === 'new') setFresh(true);
    else if (notes.trim() || waiting) {
      send({ type: 'keepPlanning', id: session.id, ...(notes.trim() ? { feedback: notes } : {}) });
      setNotes('');
    } else {
      // Without a waiting request there's nothing to decline; notes are what keeps planning.
      setHint(`Add notes for ${name}, then choose this again.`);
      notesBox.current?.focus();
    }
  }
  // ⌘/Ctrl+Enter implements in Auto, as before, unless you're writing in the message box.
  const latest = useRef(pick);
  latest.current = pick;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      const box = document.querySelector<HTMLTextAreaElement>('.composer textarea');
      if (box?.value.trim()) return;
      event.preventDefault();
      latest.current('auto');
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <fieldset
      className="plan-options mb-2 rounded-lg border border-subtle bg-surface p-3 outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      aria-label="Plan choices"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.querySelector<HTMLButtonElement>('.plan-option')?.focus();
          }
          return;
        }
        if (event.target instanceof HTMLSelectElement || event.metaKey || event.ctrlKey) return;
        if (event.key === 'Enter' && (event.target as HTMLElement).closest('.plan-option')) {
          event.preventDefault();
          pick(selected);
          return;
        }
        const index = Number(event.key) - 1;
        const option = options[index];
        if (!option || event.altKey) return;
        event.preventDefault();
        submitted.current = false;
        setSelected(option.id);
        event.currentTarget
          .querySelector<HTMLButtonElement>(`.plan-option[data-choice="${option.id}"]`)
          ?.focus();
      }}
    >
      <label className="block">
        <span className="sr-only">Notes for {name}</span>
        <textarea
          ref={notesBox}
          rows={1}
          value={notes}
          placeholder={`Notes for ${name} (optional): what to change, or what to keep in mind`}
          onChange={(event) => {
            setNotes(event.target.value);
            setHint('');
          }}
          className="field-sizing-content block max-h-40 min-h-8 w-full resize-none rounded-md border border-subtle bg-raised px-2.5 py-1.5 text-[12.5px] leading-[1.5] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-[var(--focus,var(--accent))]"
        />
      </label>
      {hint ? <p className="m-0 mt-1.5 text-[11.5px] text-warning">{hint}</p> : null}
      <ol className="m-0 mt-2 grid list-none gap-1 p-0" aria-label="Your answer">
        {options.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              className={`plan-option group w-full justify-start gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] ${
                selected === option.id
                  ? 'border-transparent bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-foreground enabled:hover:bg-[color-mix(in_srgb,var(--accent)_24%,transparent)]'
                  : 'border-subtle text-foreground enabled:hover:bg-raised'
              } ${option.id === 'new' && fresh ? 'bg-raised' : ''}`}
              aria-expanded={option.id === 'new' ? fresh : undefined}
              onClick={() => {
                submitted.current = false;
                setSelected(option.id);
              }}
              data-choice={option.id}
              aria-pressed={selected === option.id}
            >
              <kbd className="grid size-[18px] shrink-0 place-items-center rounded border border-subtle font-mono text-[10.5px] text-muted-foreground">
                {index + 1}
              </kbd>
              <span className="min-w-0 flex-1">
                <span className="block">{option.label}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {option.hint}
                </span>
              </span>
              {index === 0 ? (
                <span className="shrink-0 text-[10.5px] text-muted-foreground">{BUILD_KEY}</span>
              ) : null}
            </button>
            {option.id === 'new' && fresh && context ? (
              <div className="ml-7 mt-1 mb-1 flex flex-wrap items-center gap-1.5">
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
                  <select
                    aria-label="Recently used models"
                    className="max-w-40 bg-surface text-xs"
                    value=""
                    onChange={(event) => {
                      const item = recent[Number(event.target.value)];
                      if (item)
                        setChoice({
                          agent: agentKind(item),
                          model: item.model,
                          effort: item.effort,
                        });
                    }}
                  >
                    <option value="" disabled>
                      Recently used
                    </option>
                    {recent.map((item, index) => (
                      <option key={item.id} value={index}>
                        {profileLabel(agentKind(item))} · {item.model ?? 'Default'}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button
                  size="sm"
                  className="ml-auto h-7 px-2.5 text-xs"
                  onClick={() => {
                    if (submitted.current) return;
                    submitted.current = true;
                    send({
                      type: 'buildPlan',
                      id: session.id,
                      ...choice,
                      agent: selectedAgent,
                      ...withNotes,
                    });
                  }}
                >
                  Start in Auto
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => pick(selected)}>
        Confirm choice ↵
      </Button>
      <p className="m-0 mt-2 text-[11px] text-muted-foreground">
        Or reply in the message box to keep planning.
      </p>
    </fieldset>
  );
}
