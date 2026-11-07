import { useEffect, useRef, useState } from 'react';
import type { AgentSetup } from '../../../shared/model';
import { AgentMark, Icon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { AccountDetails } from './account-details';
import { ProfileForm } from './profile-form';
import { useProfileRequests } from './use-profile-requests';

export function AccountsPanel({
  agents,
  intent,
  onChat,
}: {
  agents?: AgentSetup;
  intent: { profile?: string; create?: boolean; key: number };
  onChat: () => void;
}) {
  const requests = useProfileRequests();
  const [adding, setAdding] = useState(Boolean(intent.create));
  const [selected, setSelected] = useState(intent.profile);
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const profiles = agents?.profiles ?? [];
  const profile = profiles.find((item) => item.id === selected);
  useEffect(() => {
    setAdding(Boolean(intent.create));
    setSelected(intent.profile);
    setNotice('');
    heading.current?.focus();
  }, [intent]);
  function select(id: string) {
    setSelected(id);
    setAdding(false);
    setNotice('');
  }
  return (
    <section
      aria-label="Accounts"
      className="accounts-panel min-h-0 flex-1 overflow-y-auto px-4 py-6 @container"
    >
      <div className="mx-auto max-w-[520px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 ref={heading} tabIndex={-1} className="m-0 text-base font-semibold outline-none">
              {adding ? 'Add an account' : 'Accounts'}
            </h1>
            <p className="mb-0 mt-1 text-xs text-muted-foreground">
              Your agents, with your own accounts.
            </p>
          </div>
          {!adding ? (
            <Button
              size="xs"
              variant="secondary"
              disabled={requests.pending}
              onClick={() => {
                setAdding(true);
                setNotice('');
              }}
            >
              <Icon name="plus" size={12} />
              Add account
            </Button>
          ) : null}
        </div>
        {requests.error ? (
          <p
            role="alert"
            className="rounded-md border border-strong p-3 text-xs text-error wrap-anywhere"
          >
            {requests.error}
          </p>
        ) : null}
        {adding ? (
          <ProfileForm
            key={intent.key}
            agents={agents}
            requests={requests}
            onCancel={() => setAdding(false)}
            onCreated={(id) => {
              select(id);
              setNotice('Account added. Open the sign-in terminal to connect it.');
            }}
          />
        ) : (
          <>
            <div className="mt-5 divide-y divide-subtle border-y border-subtle">
              {profiles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={requests.pending}
                  aria-pressed={item.id === selected}
                  className="flex w-full items-center gap-3 px-2 py-3 text-left aria-pressed:bg-muted enabled:hover:bg-muted rounded-none"
                  onClick={() => select(item.id)}
                >
                  <AgentMark agent={item.id} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      @{item.id}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {item.status === 'ready'
                      ? 'CLI installed'
                      : item.status === 'missingCli'
                        ? 'Install needed'
                        : item.status === 'missingFolder'
                          ? 'Folder missing'
                          : 'Checking…'}
                  </span>
                  <Icon name="chevronDown" size={12} />
                </button>
              ))}
            </div>
            {profile ? (
              <AccountDetails
                key={`${profile.id}:${intent.key}`}
                profile={profile}
                requests={requests}
                setNotice={setNotice}
                onRemoved={() => setSelected(undefined)}
              />
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Choose an account to sign in or manage it.
              </p>
            )}
          </>
        )}
        {notice ? (
          <output className="block mt-4 text-xs text-muted-foreground leading-relaxed">
            {notice}
          </output>
        ) : null}
        {!adding ? (
          <Button
            className="mt-4"
            variant="ghost"
            size="xs"
            disabled={requests.pending}
            onClick={onChat}
          >
            Back to chat
          </Button>
        ) : null}
      </div>
    </section>
  );
}
