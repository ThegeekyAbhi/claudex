import { useId } from 'react';
import {
  type AgentKind,
  agentKind,
  type ConfigurationDeclaration,
  type ConfigurationSource,
  findProfile,
  type Session,
} from '../../../shared/model';
import { Icon } from '../../components/icons';
import { Hint } from '../../components/menus';
import { Button } from '../../components/ui/button';
import { useConfiguration } from './use-configuration';

const RESOLUTION: Record<ConfigurationDeclaration['resolution'], string> = {
  localWinner: 'Local winner · estimated',
  overridden: 'Overridden locally',
  declarationOnly: 'Declared · applicability unverified',
  constraint: 'Managed declaration · native resolution required',
};
function baseline(value: unknown, allowed: string[]): string {
  return typeof value === 'string' && allowed.includes(value) ? value : 'Custom or unreported';
}

function SessionConfiguration({ session }: { session?: Session }) {
  if (!session)
    return (
      <p className="m-0 text-muted-foreground">
        No session observations for this profile. File inspection never starts or resumes a session.
      </p>
    );
  const runtime = session.runtime;
  const sandbox = session.nativeSettings?.sandbox;
  const sandboxType =
    sandbox && typeof sandbox === 'object' && 'type' in sandbox ? sandbox.type : sandbox;
  return (
    <div className="space-y-2 rounded-md border border-subtle px-3 py-2">
      <p className="m-0 text-muted-foreground">
        Reports describe what this session last reported, not whether it reloaded the files below.
      </p>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 break-words [&_dt]:text-muted-foreground">
        <dt>Requested turn mode</dt>
        <dd className="m-0">{session.mode ?? 'Native defaults'}</dd>
        <dt>Reported mode</dt>
        <dd className="m-0">{session.reportedMode ?? 'Not reported'}</dd>
        {session.provider === 'codex' ? (
          <>
            <dt>Baseline approval policy</dt>
            <dd className="m-0">
              {baseline(session.nativeSettings?.approvalPolicy, [
                'untrusted',
                'on-failure',
                'on-request',
                'never',
              ])}
            </dd>
          </>
        ) : null}
        {session.provider === 'codex' ? (
          <>
            <dt>Baseline sandbox</dt>
            <dd className="m-0">
              {baseline(sandboxType, [
                'readOnly',
                'workspaceWrite',
                'dangerFullAccess',
                'externalSandbox',
              ])}
            </dd>
          </>
        ) : null}
        <dt>Last native event</dt>
        <dd className="m-0">
          {runtime?.observedAt ? new Date(runtime.observedAt).toLocaleString() : 'Not recorded'}
        </dd>
        <dt>Native skill inventory</dt>
        <dd className="m-0">
          {runtime?.skillNames
            ? `${runtime.skillNames.length} reported at session initialization; invocation unverified`
            : 'Not reported or invalidated'}
        </dd>
      </dl>
      {runtime?.skillNames?.length ? (
        <details>
          <summary>Reported skill names</summary>
          <p className="break-words">{runtime.skillNames.join(', ')}</p>
        </details>
      ) : null}
      {runtime?.mcpServers ? (
        <details>
          <summary>Last reported MCP status</summary>
          <ul className="m-0 pl-4">
            {runtime.mcpServers.map((server) => (
              <li key={server.name}>
                {server.name}: {server.status ?? 'Unknown'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const STATUS: Record<ConfigurationSource['status'], string> = {
  read: 'Read',
  partial: 'Partly read',
  missing: 'No file',
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
};
const SCOPE: Record<ConfigurationSource['scope'], string> = {
  system: 'System',
  user: 'User',
  project: 'Project',
  projectLocal: 'Project (local)',
  managed: 'Managed',
};
const HEADING = 'm-0 mb-1.5 text-[11px] font-medium text-muted-foreground';

export function ConfigurationView({
  agent,
  cwd,
  session,
}: {
  agent: AgentKind;
  cwd?: string;
  session?: Session;
}) {
  const heading = useId();
  const profile = findProfile(agent);
  const identity = JSON.stringify([
    profile?.version,
    profile?.homeDir,
    profile?.executable,
    profile?.executablePath,
  ]);
  const { state, refresh } = useConfiguration(agent, cwd, identity);
  const inspection = state?.inspection;
  const activeSession = session && agentKind(session) === agent ? session : undefined;
  const loading = Boolean(cwd) && (!state || state.status === 'loading');
  return (
    <section aria-labelledby={heading} className="space-y-5 text-[11.5px]">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={heading} className="m-0 text-[12.5px] font-medium">
            Effective configuration
          </h2>
          <p className="m-0 mt-0.5 text-muted-foreground">
            Read only. These are local estimates; managed policy, trust and launch flags can change
            the result. Credential values are hidden.
          </p>
          <p className="m-0 mt-0.5 text-faint">
            {[
              profile?.version,
              inspection
                ? `scanned ${new Date(inspection.observedAt).toLocaleString()}`
                : undefined,
              inspection?.host ?? undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
            {inspection && state?.status !== 'ready' ? ' · previous results, possibly stale' : ''}
          </p>
        </div>
        <Hint label="Refresh configuration">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh configuration"
            disabled={!cwd || state?.status === 'loading'}
            onClick={refresh}
          >
            <Icon name="refresh" size={13} />
          </Button>
        </Hint>
      </header>

      {!cwd ? (
        <p className="m-0 text-muted-foreground">Select a thread or open a project file.</p>
      ) : null}
      {loading ? <output className="block">Inspecting configuration files…</output> : null}
      {state?.error ? (
        <div role="alert" className="rounded-md border border-strong p-3 text-error wrap-anywhere">
          {state.error}{' '}
          <button type="button" className="underline underline-offset-2" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : null}

      {inspection ? (
        <>
          <section aria-label="Configuration declarations">
            <h3 className={HEADING}>Settings and overrides</h3>
            {inspection.declarations.length ? (
              <ul className="m-0 list-none divide-y divide-subtle rounded-md border border-subtle p-0">
                {inspection.declarations.map((row, index) => {
                  const source = inspection.sources.find((item) => item.id === row.sourceId);
                  return (
                    <li
                      key={`${row.sourceId}:${row.key}:${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2"
                    >
                      <code className="font-[var(--mono)] text-[11.5px] text-foreground wrap-anywhere">
                        {row.key}
                      </code>
                      <code className="font-[var(--mono)] text-[11.5px] text-foreground wrap-anywhere text-right">
                        {row.value}
                      </code>
                      <span
                        className="col-span-2 text-[11px] text-muted-foreground wrap-anywhere"
                        title={source?.path}
                      >
                        {RESOLUTION[row.resolution]} · {source?.scope ?? 'Unknown source'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="m-0 rounded-md border border-dashed border-subtle px-3 py-2.5 text-muted-foreground">
                No skill or safety settings are declared in these files. That doesn’t establish the
                CLI’s defaults or that no policy applies.
              </p>
            )}
          </section>

          <section aria-label="Configuration sources">
            <h3 className={HEADING}>Configuration sources ({inspection.sources.length})</h3>
            <ul className="m-0 list-none divide-y divide-subtle rounded-md border border-subtle p-0">
              {inspection.sources.map((source) => (
                <li
                  key={source.id}
                  className={`grid grid-cols-[6.5rem_9rem_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-1.5 @max-[480px]:grid-cols-[minmax(0,1fr)_auto] ${source.status === 'missing' ? 'text-muted-foreground' : ''}`}
                >
                  <span className="font-medium">{SCOPE[source.scope]}</span>
                  <span className="text-muted-foreground">
                    {STATUS[source.status]}
                    {source.managed ? ' · read only' : ''}
                  </span>
                  <span
                    className="truncate font-[var(--mono)] text-[11px] text-muted-foreground @max-[480px]:col-span-2"
                    title={source.path}
                  >
                    {source.path}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {inspection.limitations.length ? (
            <details className="group rounded-md border border-subtle px-3 py-2">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                What this can’t tell you ({inspection.limitations.length})
              </summary>
              <ul className="m-0 mt-2 space-y-1 pl-4 text-muted-foreground">
                {inspection.limitations.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {/* From the live session, so shown whatever the file scan is doing. */}
      <section aria-label="Selected session observations">
        <h3 className={HEADING}>This session</h3>
        <SessionConfiguration session={activeSession} />
      </section>
    </section>
  );
}
