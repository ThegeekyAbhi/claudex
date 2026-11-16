import { useContext, useEffect, useRef, useState } from 'react';
import {
  INSTALL_HELP,
  needsSignIn,
  type OnboardingStage,
  type Provider,
  type SetupRow,
  STARTER_PROMPTS,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon, type IconName } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { AccountsNavigation } from '../accounts/navigation';
import { Mascot } from '../mascot/mascot';

const STARTERS: { title: string; icon: IconName }[] = [
  { title: 'Explore this project', icon: 'folder' },
  { title: 'Review my changes', icon: 'diff' },
  { title: 'Suggest improvements', icon: 'logo' },
];

/**
 * The empty workspace while something is left to do: install an agent or sign in.
 * Steps that are already done are not shown at all; once ready, see HomeHeading and HomeExtras.
 */
export function Onboarding({
  stage,
  rows,
}: {
  stage: Exclude<OnboardingStage, 'hidden' | 'ready'>;
  rows: SetupRow[];
}) {
  return (
    <section
      aria-label="Set up Claudex"
      data-stage={stage}
      key={stage}
      className="onboarding onboarding-enter mx-auto mb-3 max-w-[560px] pt-6 max-[900px]:pt-3"
    >
      {stage === 'install' ? <InstallStep rows={rows} /> : null}
      {stage === 'signIn' ? <SignInStep rows={rows} /> : null}
    </section>
  );
}

function Heading({ title, detail, busy }: { title: string; detail: string; busy?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Mascot activity={busy ? 'working' : 'attentive'} size={36} />
      <div className="min-w-0">
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        <p className="m-0 mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function CheckAgain({ busy, label = 'Check again' }: { busy: boolean; label?: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-busy={busy}
      disabled={busy}
      onClick={() => send({ type: 'refreshAgents' })}
    >
      <Icon name="refresh" size={12} />
      {busy ? 'Checking…' : label}
    </Button>
  );
}

/** Nothing can run yet: one CLI to install, picked from a toggle, with its command to copy. */
function InstallStep({ rows }: { rows: SetupRow[] }) {
  const openAccounts = useContext(AccountsNavigation);
  const [provider, setProvider] = useState<Provider>('claude');
  const install = INSTALL_HELP[provider];
  const checking = rows.some((row) => row.state === 'checking');
  const folders = rows.filter((row) => row.state === 'missingFolder');
  return (
    <>
      <Heading
        title="Install an agent to start"
        detail="Claudex runs the Claude Code or Codex CLI on your own account."
        busy={checking}
      />
      <div className="mt-4 rounded-lg border border-subtle bg-surface p-3">
        <fieldset
          aria-label="Agent to install"
          className="m-0 inline-flex min-w-0 rounded-md border border-subtle p-0.5"
        >
          {(['claude', 'codex'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={provider === item}
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
              onClick={() => setProvider(item)}
            >
              <AgentMark agent={item} size={12} />
              {INSTALL_HELP[item].name}
            </button>
          ))}
        </fieldset>
        <p className="m-0 mt-3 mb-1.5 text-[11px] text-muted-foreground">
          Run this in a terminal, then come back:
        </p>
        <CopyCommand command={install.command} />
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <CheckAgain busy={checking} label="I’ve installed it" />
          <Button
            variant="ghost"
            size="xs"
            onClick={() => send({ type: 'link', href: install.docs })}
          >
            <Icon name="external" size={12} />
            Install guide
          </Button>
        </div>
      </div>
      {folders.length ? (
        <ul className="m-0 mt-3 list-none space-y-1 p-0 text-[11px] text-muted-foreground">
          {folders.map((row) => (
            <li key={row.id} className="flex min-w-0 items-center gap-2">
              <AgentMark agent={row.id} size={12} />
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="text-foreground">{row.label}</span>: {row.problem}
              </span>
              <Button variant="ghost" size="xs" onClick={() => openAccounts(row.id)}>
                Fix
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Installed, but every agent says it is signed out. Sign-in happens in the CLI's own terminal. */
function SignInStep({ rows }: { rows: SetupRow[] }) {
  const installed = rows.filter((row) => row.state === 'installed');
  const checking = rows.some((row) => row.state === 'checking');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  return (
    <>
      <Heading
        title="Sign in to start"
        detail="Sign in once in the CLI’s own terminal. Claudex never sees your credentials."
        busy={checking}
      />
      <ul
        aria-label="Accounts"
        className="m-0 mt-4 list-none divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface p-0"
      >
        {installed.map((row) => (
          <li key={row.id} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
            <AgentMark agent={row.id} size={16} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.label}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {opened.has(row.id) ? 'Finish in the terminal' : 'Signed out'}
            </span>
            <Button
              variant="outline"
              size="xs"
              aria-label={`Sign in to ${row.label}`}
              onClick={() => {
                send({ type: 'signInProfile', id: row.id });
                setOpened((current) => new Set(current).add(row.id));
              }}
            >
              Sign in
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-1">
        <CheckAgain busy={checking} />
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground"
          onClick={() => send({ type: 'dismissOnboarding' })}
        >
          Skip for now
        </Button>
      </div>
    </>
  );
}

/** The new-chat greeting that sits above the message box. */
export function HomeHeading({ project }: { project?: string }) {
  return (
    <div className="home-heading flex flex-col items-center text-center">
      <Mascot activity="attentive" size={36} />
      <h2 className="m-0 mt-3 text-[15px] font-semibold">
        What should we build{project ? ` in ${project}` : ''}?
      </h2>
    </div>
  );
}

/** Starter ideas, shortcuts, and your accounts, shown below the message box. */
export function HomeExtras({
  rows,
  onPrompt,
  className = '',
  pending = false,
}: {
  rows: SetupRow[];
  onPrompt: (text: string) => void;
  className?: string;
  /** A new thread is starting: the ideas stay visible but quiet until it opens. */
  pending?: boolean;
}) {
  return (
    <div
      aria-disabled={pending || undefined}
      className={`home-extras flex flex-col items-center text-center transition-opacity duration-200 ${pending ? 'pointer-events-none opacity-40' : ''} ${className}`}
    >
      <div className="flex flex-wrap justify-center gap-1.5">
        {STARTER_PROMPTS.map((prompt, index) => {
          const starter = STARTERS[index] ?? { title: prompt, icon: 'thread' };
          return (
            <button
              key={prompt}
              type="button"
              aria-label={starter.title}
              title={prompt}
              className="starter-prompt flex items-center gap-1.5 rounded-full border border-subtle px-3 py-1.5 text-xs text-muted-foreground hover:border-strong hover:bg-muted hover:text-foreground"
              onClick={() => onPrompt(prompt)}
            >
              <Icon name={starter.icon} size={12} />
              {starter.title}
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
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
      <AccountStrip rows={rows} />
    </div>
  );
}

function authHint(row: SetupRow): string {
  if (row.state === 'checking') return `${row.label} · checking`;
  const auth = row.auth;
  if (auth?.state === 'signedIn')
    return [row.label, auth.method ? `Signed in with ${auth.method}` : 'Signed in', auth.plan]
      .filter(Boolean)
      .join(' · ');
  if (auth?.state === 'signedOut') return `${row.label} · Signed out`;
  return `${row.label} · Couldn’t check sign-in`;
}

/** Your installed accounts at a glance. Opens Accounts; points at one that needs sign-in. */
function AccountStrip({ rows }: { rows: SetupRow[] }) {
  const openAccounts = useContext(AccountsNavigation);
  const checking = rows.some((row) => row.state === 'checking');
  const shown = rows.filter((row) => row.state === 'installed' || row.state === 'checking');
  const signedOut = shown.filter(needsSignIn);
  const signedIn = shown.filter((row) => row.auth?.state === 'signedIn');
  const count = shown.length;
  const label = checking
    ? 'Checking accounts…'
    : signedOut.length
      ? `${signedOut.length} ${signedOut.length === 1 ? 'needs' : 'need'} sign-in`
      : `${count} ${count === 1 ? 'account' : 'accounts'}${signedIn.length === count ? ' ready' : ''}`;
  return (
    <button
      type="button"
      aria-label={`${label}. Manage accounts`}
      className="account-strip mt-6 flex items-center gap-2 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => openAccounts(signedOut[0]?.id)}
    >
      <span className="flex items-center">
        {shown.map((row, index) => (
          <span
            key={row.id}
            title={authHint(row)}
            data-auth={row.state === 'checking' ? 'checking' : (row.auth?.state ?? 'unknown')}
            className={`account-chip relative grid size-5 place-items-center rounded-full border border-subtle bg-surface ${index ? '-ml-1.5' : ''} ${row.state === 'checking' ? 'animate-pulse' : ''}`}
          >
            <AgentMark agent={row.id} size={11} />
          </span>
        ))}
      </span>
      <span className={signedOut.length ? 'text-warning' : ''}>{label}</span>
      <span aria-hidden="true">·</span>
      <span>Manage</span>
    </button>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState('copied');
    } catch {
      // Clipboard can be unavailable; the command stays selectable, so say to copy it by hand.
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }
  const copied = state === 'copied';
  const label = copied
    ? 'Copied'
    : state === 'failed'
      ? 'Couldn’t copy. Select the command and copy it'
      : 'Copy install command';
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md border border-subtle bg-background pl-2.5">
      <span aria-hidden="true" className="text-[11px] text-muted-foreground">
        $
      </span>
      <code className="min-w-0 flex-1 truncate select-all py-1.5 text-[11.5px]" title={command}>
        {command}
      </code>
      <button
        type="button"
        className="icon-button shrink-0 p-1.5 text-muted-foreground"
        aria-label={label}
        title={label}
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
