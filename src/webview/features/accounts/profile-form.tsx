import { useEffect, useRef, useState } from 'react';
import {
  type AgentSetup,
  allProfiles,
  INSTALL_HELP,
  PROFILE_ID,
  type Provider,
  profileIdFrom,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark } from '../../components/icons';
import { Button } from '../../components/ui/button';
import type { useProfileRequests } from './use-profile-requests';

const FIELD =
  'w-full min-w-0 rounded-md border border-strong bg-raised px-2.5 py-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function ProfileForm({
  agents,
  requests,
  onCreated,
  onCancel,
}: {
  agents?: AgentSetup;
  requests: ReturnType<typeof useProfileRequests>;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [provider, setProvider] = useState<Provider>('claude');
  const [name, setName] = useState('');
  const [customId, setCustomId] = useState<string>();
  const [executable, setExecutable] = useState('');
  const [source, setSource] = useState('new');
  const [picked, setPicked] = useState<{ path: string; token: string }>();
  const taken = allProfiles().map((profile) => profile.id);
  const id = customId ?? profileIdFrom(name || `${provider}-work`, taken);
  const validId = PROFILE_ID.test(id) && !taken.includes(id);
  const suggestions = (agents?.suggestions ?? []).filter((item) => item.provider === provider);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !validId || (source === 'picked' && !picked)) return;
    const result = await requests.request({
      operation: 'create',
      provider,
      name: name.trim(),
      id,
      folder:
        source === 'new'
          ? { kind: 'new' }
          : source === 'picked' && picked
            ? { kind: 'picked', token: picked.token }
            : { kind: 'suggested', path: source },
      ...(executable.trim() ? { executable: executable.trim() } : {}),
    });
    if (mounted.current && result?.id) onCreated(result.id);
  }
  return (
    <form onSubmit={save} className="mt-5 space-y-4" aria-label="Add account">
      <fieldset disabled={requests.pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <legend className="mb-2 text-xs font-medium">Choose your agent</legend>
        <div className="flex gap-2">
          {(['claude', 'codex'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={provider === item}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-strong px-3 py-2 text-xs aria-pressed:bg-muted aria-pressed:text-foreground text-muted-foreground"
              onClick={() => {
                setProvider(item);
                setSource('new');
                setPicked(undefined);
              }}
            >
              <AgentMark agent={item} size={16} />
              {item === 'claude' ? 'Claude Code' : 'Codex'}
            </button>
          ))}
        </div>
        {agents?.profiles.some(
          (profile) =>
            profile.builtin && profile.provider === provider && profile.status === 'missingCli',
        ) ? (
          <p className="m-0 text-[11px] text-muted-foreground">
            {INSTALL_HELP[provider].name} needs to be installed.{' '}
            <button
              type="button"
              className="text-[var(--link)] hover:underline"
              onClick={() => send({ type: 'link', href: INSTALL_HELP[provider].docs })}
            >
              Open install guide
            </button>
          </p>
        ) : null}
        <label className="block space-y-1.5 text-xs">
          Account name
          <input
            className={FIELD}
            value={name}
            maxLength={60}
            placeholder="e.g. Work"
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-xs">
          Account folder
          <select
            className={FIELD}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="new">Create a separate account</option>
            {suggestions.map((item) => (
              <option key={item.path} value={item.path}>
                Use {item.path}
              </option>
            ))}
            <option value="picked">Use an existing folder…</option>
          </select>
        </label>
        {source === 'picked' ? (
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="flex-1 truncate text-muted-foreground" title={picked?.path}>
              {picked?.path ?? 'Choose the folder for this account.'}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={async () => {
                const result = await requests.request({ operation: 'pickFolder' });
                if (mounted.current && result?.folder && result.token)
                  setPicked({ path: result.folder, token: result.token });
              }}
            >
              Browse
            </Button>
          </div>
        ) : (
          <p className="m-0 text-[11px] text-muted-foreground wrap-anywhere">
            {source === 'new'
              ? `~/.${provider}-${id} · Separate sign-in, settings and skills.`
              : 'Uses the sign-in and settings already in this folder.'}
          </p>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Advanced</summary>
          <div className="mt-3 space-y-3">
            <label className="block space-y-1.5">
              Mention handle
              <input
                className={FIELD}
                value={id}
                maxLength={24}
                aria-invalid={!validId}
                onChange={(event) => setCustomId(event.target.value)}
              />
            </label>
            {!validId ? (
              <p className="text-warning">
                Use a unique handle: lowercase letters, digits and dashes, starting with a letter.
              </p>
            ) : null}
            <p className="text-[11px]">@{id} stays the same when you rename this account.</p>
            <label className="block space-y-1.5">
              CLI executable (optional)
              <input
                className={FIELD}
                value={executable}
                placeholder={provider}
                onChange={(event) => setExecutable(event.target.value)}
              />
            </label>
          </div>
        </details>
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            type="submit"
            disabled={!name.trim() || !validId || (source === 'picked' && !picked)}
          >
            {requests.pending ? 'Saving…' : 'Add account'}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
