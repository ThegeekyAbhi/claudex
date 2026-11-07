import { useContext } from 'react';
import {
  INSTALL_HELP,
  noAgentInstalled,
  type SetupRow,
  STARTER_PROMPTS,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { AccountsNavigation } from '../accounts/navigation';

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
  const prompts = ['Explore this project', 'Review my changes', 'Suggest improvements'];
  return (
    <section aria-label="Set up Claudex" className="setup-card max-w-[780px] mx-auto mb-3 pt-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold">
          {blocked ? 'Install an agent to start' : 'Make yourself at home'}
        </h2>
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
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Choose an agent. Sign in with your own account.
      </p>
      <ul className="m-0 list-none p-0 divide-y divide-subtle border-y border-subtle">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 py-2.5 min-w-0">
            <AgentMark agent={row.id} size={16} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {row.state === 'installed'
                ? 'CLI installed'
                : row.state === 'missingCli'
                  ? 'Not installed'
                  : row.state === 'missingFolder'
                    ? 'Folder missing'
                    : 'Checking…'}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={row.state === 'checking'}
              onClick={() => openAccounts(row.id)}
            >
              {row.state === 'installed' ? 'Sign in' : 'Set up'}
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-1">
        <Button variant="ghost" size="xs" onClick={() => openAccounts(undefined, true)}>
          Add account
        </Button>
        <Button variant="ghost" size="xs" onClick={() => send({ type: 'refreshAgents' })}>
          Check again
        </Button>
      </div>
      {!blocked ? (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {STARTER_PROMPTS.map((prompt, index) => (
            <button
              key={prompt}
              type="button"
              className="starter-prompt rounded-md border border-subtle px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onPrompt(prompt)}
            >
              {prompts[index]}
            </button>
          ))}
        </div>
      ) : null}
      <details className="mt-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Setup help and shortcuts</summary>
        <p>⇧Tab switches modes. Use @ for context and / for skills.</p>
        {rows.map((row) => (
          <div key={row.id} className="my-2 wrap-anywhere">
            {row.label}: {row.version ?? row.problem ?? 'Checking…'}
            {row.state === 'missingCli' ? (
              <code className="mt-1 block select-all">{INSTALL_HELP[row.provider].command}</code>
            ) : null}
          </div>
        ))}
      </details>
    </section>
  );
}
