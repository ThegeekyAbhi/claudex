import { useContext, useState } from 'react';
import {
  INSTALL_HELP,
  noAgentInstalled,
  type SetupRow,
  type SetupState,
  STARTER_PROMPTS,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon, type IconName } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { AccountsNavigation } from '../accounts/navigation';
import { Mascot } from '../mascot/mascot';

const STATE_LABEL: Record<SetupState, string> = {
  installed: 'CLI installed',
  missingCli: 'Not installed',
  missingFolder: 'Folder missing',
  checking: 'Checking…',
};
const STATE_TONE: Record<SetupState, string> = {
  installed: 'text-success border-success/35',
  missingCli: 'text-warning border-warning/35',
  missingFolder: 'text-warning border-warning/35',
  checking: 'text-muted-foreground border-subtle',
};
const STARTERS: { title: string; icon: IconName }[] = [
  { title: 'Explore this project', icon: 'folder' },
  { title: 'Review my changes', icon: 'diff' },
  { title: 'Suggest improvements', icon: 'logo' },
];

type StepState = 'done' | 'current' | 'upcoming';
/**
 * Only installation is something this extension can verify. Sign-in lives in each CLI's own
 * credentials, so that step is offered, never marked done.
 */
function steps(rows: SetupRow[]): { label: string; state: StepState }[] {
  const installed = rows.some((row) => row.state === 'installed');
  return [
    { label: 'Install a CLI', state: installed ? 'done' : 'current' },
    { label: 'Sign in', state: installed ? 'current' : 'upcoming' },
    { label: 'Start a thread', state: installed ? 'current' : 'upcoming' },
  ];
}

export function SetupCard({
  rows,
  dismissible,
  onPrompt,
}: {
  rows: SetupRow[];
  dismissible: boolean;
  onPrompt: (text: string) => void;
}) {
  const openAccounts = useContext(AccountsNavigation);
  const blocked = noAgentInstalled(rows);
  const checking = rows.some((row) => row.state === 'checking');
  return (
    <section aria-label="Set up Claudex" className="setup-card max-w-195 mx-auto mb-3 pt-3">
      <div className="flex items-start gap-3">
        <Mascot activity={checking ? 'working' : 'attentive'} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[15px] font-semibold">
            {blocked ? 'Install an agent to start' : 'Make yourself at home'}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">
            Claudex runs the Claude Code and Codex CLIs you already have, with your own accounts.
          </p>
        </div>
        {dismissible ? (
          <button
            type="button"
            className="icon-button p-1 text-muted-foreground"
            aria-label="Don’t show again"
            title="Don’t show again"
            onClick={() => send({ type: 'dismissOnboarding' })}
          >
            <Icon name="close" size={12} />
          </button>
        ) : null}
      </div>

      <ol aria-label="Setup steps" className="m-0 mt-3 flex list-none items-center gap-1.5 p-0">
        {steps(rows).map((step, index) => (
          <li
            key={step.label}
            data-state={step.state}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground data-[state=current]:text-foreground"
          >
            <span
              className={`grid size-4 shrink-0 place-items-center rounded-full border text-[9.5px] ${
                step.state === 'done'
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : step.state === 'current'
                    ? 'border-foreground/60'
                    : 'border-subtle'
              }`}
            >
              {step.state === 'done' ? <Icon name="check" size={10} /> : index + 1}
            </span>
            <span className="truncate">{step.label}</span>
            {index < 2 ? <span className="h-px min-w-3 flex-1 bg-subtle" /> : null}
          </li>
        ))}
      </ol>

      <ul className="m-0 mt-3 grid list-none gap-2 p-0 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {rows.map((row) => (
          <AgentCard key={row.id} row={row} onOpen={() => openAccounts(row.id)} />
        ))}
      </ul>
      <div className="mt-2 flex gap-1">
        <Button variant="ghost" size="xs" onClick={() => openAccounts(undefined, true)}>
          <Icon name="plus" size={12} />
          Add account
        </Button>
        <Button
          variant="ghost"
          size="xs"
          aria-busy={checking}
          onClick={() => send({ type: 'refreshAgents' })}
        >
          Check again
        </Button>
      </div>

      {!blocked ? (
        <div className="mt-4">
          <h3 className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Try asking
          </h3>
          <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
            {STARTER_PROMPTS.map((prompt, index) => {
              const starter = STARTERS[index] ?? { title: prompt, icon: 'thread' };
              return (
                <button
                  key={prompt}
                  type="button"
                  aria-label={starter.title}
                  className="starter-prompt flex flex-col items-start gap-1 rounded-md border border-subtle px-2.5 py-2 text-left hover:bg-muted"
                  onClick={() => onPrompt(prompt)}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Icon name={starter.icon} size={12} />
                    {starter.title}
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {prompt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <p className="mb-0 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <Kbd>⇧Tab</Kbd> modes
        </span>
        <span>
          <Kbd>@</Kbd> context
        </span>
        <span>
          <Kbd>/</Kbd> skills
        </span>
      </p>
    </section>
  );
}

function AgentCard({ row, onOpen }: { row: SetupRow; onOpen: () => void }) {
  const install = INSTALL_HELP[row.provider];
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-subtle bg-surface p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <AgentMark agent={row.id} size={16} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.label}</span>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-px text-[10.5px] ${STATE_TONE[row.state]}`}
        >
          {STATE_LABEL[row.state]}
        </span>
      </div>
      {row.state === 'installed' && row.version ? (
        <span className="text-[11px] text-muted-foreground">Version {row.version}</span>
      ) : null}
      {row.state === 'missingCli' ? <CopyCommand command={install.command} /> : null}
      {row.state === 'missingFolder' && row.problem ? (
        <span className="wrap-anywhere text-[11px] text-muted-foreground">{row.problem}</span>
      ) : null}
      <div className="mt-auto flex justify-end">
        <Button
          variant={row.state === 'installed' ? 'outline' : 'ghost'}
          size="xs"
          disabled={row.state === 'checking'}
          onClick={onOpen}
        >
          {row.state === 'installed' ? 'Sign in' : 'Set up'}
        </Button>
      </div>
    </li>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable; the command stays selectable.
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-1 rounded border border-subtle bg-background pl-2">
      <code className="min-w-0 flex-1 truncate select-all text-[11px]" title={command}>
        {command}
      </code>
      <button
        type="button"
        className="icon-button shrink-0 p-1 text-muted-foreground"
        aria-label={copied ? 'Copied' : 'Copy install command'}
        title={copied ? 'Copied' : 'Copy install command'}
        onClick={copy}
      >
        <Icon name={copied ? 'check' : 'copy'} size={12} />
      </button>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="mr-1 rounded border border-subtle px-1 py-px font-sans text-[10.5px] text-foreground">
      {children}
    </kbd>
  );
}
