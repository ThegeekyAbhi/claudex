import { useEffect, useRef, useState } from 'react';
import { type AgentProfile, INSTALL_HELP } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Button } from '../../components/ui/button';
import type { useProfileRequests } from './use-profile-requests';

export function AccountDetails({
  profile,
  requests,
  setNotice,
  onRemoved,
}: {
  profile: AgentProfile;
  requests: ReturnType<typeof useProfileRequests>;
  setNotice: (text: string) => void;
  onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <div className="mt-4 space-y-3">
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await requests.request({
              operation: 'rename',
              id: profile.id,
              name,
            });
            if (mounted.current && result) {
              setEditing(false);
              setNotice('Account renamed.');
            }
          }}
        >
          <input
            aria-label="Account name"
            className="min-w-0 flex-1 rounded-md border border-strong bg-raised px-2 text-xs"
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={requests.pending}
          />
          <Button size="xs" type="submit" disabled={requests.pending || !name.trim()}>
            Save name
          </Button>
          <Button
            size="xs"
            type="button"
            variant="ghost"
            disabled={requests.pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {profile.status === 'ready' ? (
        <div className="space-y-2">
          <p className="m-0 text-xs text-muted-foreground">
            {profile.provider === 'claude'
              ? 'In the Claude Code terminal, follow sign-in or type /login.'
              : 'Codex will guide you through sign-in in its terminal.'}
          </p>
          <Button
            size="sm"
            disabled={requests.pending}
            onClick={async () => {
              const result = await requests.request({
                operation: 'signIn',
                id: profile.id,
              });
              if (mounted.current && result)
                setNotice(
                  `Sign-in terminal opened for ${profile.label}. Complete login there, then return here to chat.`,
                );
            }}
          >
            Open sign-in terminal
          </Button>
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <p className="m-0 text-muted-foreground wrap-anywhere">
            {profile.problem ?? 'Install the agent to continue.'}
          </p>
          {profile.status === 'missingCli' ? (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => send({ type: 'link', href: INSTALL_HELP[profile.provider].docs })}
            >
              Open install guide
            </Button>
          ) : null}
          <Button variant="ghost" size="xs" onClick={() => send({ type: 'refreshAgents' })}>
            Check again
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {!profile.builtin ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={requests.pending}
            onClick={() => {
              setEditing(true);
              setName(profile.label);
            }}
          >
            Rename
          </Button>
        ) : null}
        {!profile.builtin && !profile.legacy ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={requests.pending}
            onClick={() => setRemoving(true)}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {removing ? (
        <fieldset
          aria-label="Confirm account removal"
          className="rounded-md border border-strong p-3 text-xs"
        >
          <p className="mt-0">
            Remove {profile.label}? Its files and chat history stay on this machine. Chats using @
            {profile.id} need this profile to continue.
          </p>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="destructive"
              disabled={requests.pending}
              onClick={async () => {
                const result = await requests.request({
                  operation: 'remove',
                  id: profile.id,
                });
                if (mounted.current && result) {
                  onRemoved();
                  setRemoving(false);
                  setNotice('Account removed. Its files were kept.');
                }
              }}
            >
              Remove account
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={requests.pending}
              onClick={() => setRemoving(false)}
            >
              Keep account
            </Button>
          </div>
        </fieldset>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Account details</summary>
        <dl className="space-y-2 text-[11px]">
          <div>
            <dt>Folder</dt>
            <dd className="ml-0 wrap-anywhere">{profile.homeDir ?? `~/.${profile.provider}`}</dd>
          </div>
          <div>
            <dt>CLI version</dt>
            <dd className="ml-0 wrap-anywhere">{profile.version ?? 'Not reported'}</dd>
          </div>
        </dl>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => send({ type: 'openProfileFolder', id: profile.id })}
        >
          Show folder
        </Button>
        {profile.legacy ? (
          <p>This profile comes from legacy settings. Renaming saves it to your profiles.</p>
        ) : null}
      </details>
    </div>
  );
}
