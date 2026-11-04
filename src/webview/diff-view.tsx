import { memo, useMemo, useState } from 'react';
import { parsePatch } from '../diff';
import type { ChangesResult, FileDiff } from '../model';
import { send } from './bridge';
import { Icon } from './icons';

const KIND_LABELS: Record<FileDiff['kind'], string> = {
  add: 'New',
  update: '',
  delete: 'Deleted',
  rename: 'Renamed',
};
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff-stat">
      <span className="diff-add">+{additions}</span>
      <span className="diff-del">−{deletions}</span>
    </span>
  );
}
const PatchBody = memo(function PatchBody({ patch }: { patch: string }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  return (
    <div className="diff-body" role="presentation">
      {lines.map((line, index) =>
        line.kind === 'hunk' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: patch lines never reorder
          <div className="diff-line hunk" key={index}>
            <span className="diff-text">{line.text}</span>
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: patch lines never reorder
          <div className={`diff-line ${line.kind}`} key={index}>
            <span className="diff-gutter">{line.oldLine ?? ''}</span>
            <span className="diff-gutter">{line.newLine ?? ''}</span>
            <span className="diff-sign">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            <span className="diff-text">{line.text}</span>
          </div>
        ),
      )}
    </div>
  );
});
export function DiffCard({
  diff,
  sessionId,
  defaultOpen = true,
}: {
  diff: FileDiff;
  sessionId?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const kind = KIND_LABELS[diff.kind];
  return (
    <section className="diff-card" aria-label={`Changes to ${diff.path}`}>
      <div className="diff-header">
        <button
          type="button"
          className="diff-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`chevron ${open ? 'open' : ''}`}>
            <Icon name="chevron" size={11} />
          </span>
          <span className="diff-path" title={diff.path}>
            {diff.path}
          </span>
          {kind ? <span className="diff-kind">{kind}</span> : null}
        </button>
        <DiffStat additions={diff.additions} deletions={diff.deletions} />
        {sessionId ? (
          <button
            type="button"
            className="diff-open"
            aria-label={`Open ${diff.path} in the diff editor`}
            title="Open in the diff editor"
            onClick={() =>
              send({ type: 'openDiff', id: sessionId, file: diff.path, original: diff.original })
            }
          >
            <Icon name="external" size={13} />
          </button>
        ) : null}
      </div>
      {open ? (
        <>
          {diff.binary ? <p className="diff-note">Binary file; no text diff to show.</p> : null}
          {diff.patch ? <PatchBody patch={diff.patch} /> : null}
          {!diff.patch && !diff.binary ? (
            <p className="diff-note">
              {diff.truncated ? 'This file is too large to show here.' : 'No line changes.'}
            </p>
          ) : null}
          {diff.truncated && diff.patch ? (
            <p className="diff-note">
              This diff was cut short. Open it in the editor to see it all.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
/** The checkout's current state, read from Git by the host. */
export function ChangesView({
  result,
  sessionId,
  loading,
  onRefresh,
}: {
  result?: ChangesResult;
  sessionId?: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const totals = (result?.files ?? []).reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return (
    <div className="changes">
      <div className="changes-summary">
        {result?.files.length ? (
          <>
            <span>
              {result.files.length} {result.files.length === 1 ? 'file' : 'files'}
            </span>
            <DiffStat {...totals} />
          </>
        ) : (
          <span className="muted">{loading ? 'Reading changes…' : 'Working tree'}</span>
        )}
        <button type="button" className="text-action" onClick={onRefresh} disabled={!sessionId}>
          Refresh
        </button>
      </div>
      {result?.error ? <p className="changes-empty">{result.error}</p> : null}
      {!sessionId ? <p className="changes-empty">Open a thread to see its changes.</p> : null}
      {sessionId && result && !result.error && !result.files.length ? (
        <p className="changes-empty">No uncommitted changes in this checkout.</p>
      ) : null}
      {result?.files.map((file) => (
        <DiffCard
          key={file.path}
          diff={file}
          sessionId={sessionId}
          defaultOpen={result.files.length <= 8}
        />
      ))}
      {result?.truncated ? (
        <p className="changes-empty">Only the first 200 changed files are shown.</p>
      ) : null}
    </div>
  );
}
