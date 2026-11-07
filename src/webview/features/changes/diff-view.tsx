import { memo, useMemo, useState } from 'react';
import { parsePatch } from '../../../shared/domain/diff';
import type { ChangesResult, FileDiff, Session } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import { ColouredTokens } from '../../lib/coloured-lines';
import { languageOfPath, type Token, useHighlight } from '../../lib/use-highlight';

const KIND_LABELS: Record<FileDiff['kind'], string> = {
  add: 'New',
  update: '',
  delete: 'Deleted',
  rename: 'Renamed',
};
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex gap-[5px] font-mono text-[11px] tabular-nums shrink-0">
      <span className="text-add">+{additions}</span>
      <span className="text-del">−{deletions}</span>
    </span>
  );
}
/** Past this many lines a diff stays plain, so a huge one still scrolls smoothly. */
const MAX_COLOURED_LINES = 2000;
/**
 * The file before and after, each coloured as one text so strings and comments that span lines
 * colour correctly. Lines map back by position; anything that doesn't line up stays plain.
 */
function useColouredSides(lines: ReturnType<typeof parsePatch>, language: string | undefined) {
  const sides = useMemo(() => {
    const old: string[] = [];
    const now: string[] = [];
    if (lines.length <= MAX_COLOURED_LINES)
      for (const line of lines) {
        if (line.kind === 'hunk') continue;
        if (line.oldLine !== undefined) old.push(line.text);
        if (line.newLine !== undefined) now.push(line.text);
      }
    return { old: old.join('\n'), now: now.join('\n') };
  }, [lines]);
  const enabled = lines.length <= MAX_COLOURED_LINES ? language : undefined;
  const old = useHighlight(sides.old, sides.old ? enabled : undefined);
  const now = useHighlight(sides.now, sides.now ? enabled : undefined);
  return useMemo(() => {
    const coloured: (Token[] | undefined)[] = [];
    let o = 0;
    let n = 0;
    for (const line of lines) {
      let tokens: Token[] | undefined;
      if (line.kind !== 'hunk') {
        if (line.newLine !== undefined) tokens = now?.[n];
        else if (line.oldLine !== undefined) tokens = old?.[o];
        if (line.oldLine !== undefined) o++;
        if (line.newLine !== undefined) n++;
      }
      // Only when the tokens rebuild the line exactly.
      coloured.push(
        tokens && tokens.map((token) => token.content).join('') === line.text ? tokens : undefined,
      );
    }
    return coloured;
  }, [lines, old, now]);
}
const PatchBody = memo(function PatchBody({ patch, path }: { patch: string; path: string }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  const coloured = useColouredSides(lines, languageOfPath(path));
  return (
    <div
      className="border-t border-subtle max-h-[340px] overflow-auto font-mono text-[11.5px] leading-[1.5]"
      role="presentation"
    >
      {lines.map((line, index) =>
        line.kind === 'hunk' ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: patch lines never reorder
            key={index}
            className="diff-line flex min-w-max [&.add]:bg-add-bg [&.del]:bg-del-bg [&.hunk]:text-muted-foreground [&.hunk]:bg-muted hunk"
          >
            <span className="whitespace-pre pr-3 in-[.diff-line.hunk]:pl-2">{line.text}</span>
          </div>
        ) : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: patch lines never reorder
            key={index}
            className={`diff-line flex min-w-max [&.add]:bg-add-bg [&.del]:bg-del-bg [&.hunk]:text-muted-foreground [&.hunk]:bg-muted ${line.kind}`}
          >
            <span className="w-[34px] shrink-0 text-right pr-1.5 text-muted-foreground opacity-70 select-none">
              {line.oldLine ?? ''}
            </span>
            <span className="w-[34px] shrink-0 text-right pr-1.5 text-muted-foreground opacity-70 select-none">
              {line.newLine ?? ''}
            </span>
            <span className="w-3.5 shrink-0 text-center select-none in-[.diff-line.add]:text-add in-[.diff-line.del]:text-del">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            <span className="diff-code whitespace-pre pr-3 in-[.diff-line.hunk]:pl-2">
              {coloured[index] ? <ColouredTokens tokens={coloured[index]} /> : line.text}
            </span>
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
    <section
      className="mt-1.5 mb-2 border border-subtle rounded-md overflow-hidden bg-surface"
      aria-label={`Changes to ${diff.path}`}
    >
      <div className="flex items-center gap-1.5 py-0.5 pr-1.5 pl-0.5 text-[12px]">
        <button
          type="button"
          className="flex-1 min-w-0 justify-start gap-[5px] px-1 py-[3px]"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span
            className={`inline-flex text-muted-foreground transition-transform duration-[120ms] ease-[ease] [&.open]:rotate-90 motion-reduce:transition-none ${open ? 'open' : ''}`}
          >
            <Icon name="chevron" size={11} />
          </span>
          <span className="min-w-0 font-mono text-[11.5px] truncate" title={diff.path}>
            {diff.path}
          </span>
          {kind ? (
            <span className="text-[10px] text-muted-foreground border border-subtle rounded-[3px] px-1 shrink-0">
              {kind}
            </span>
          ) : null}
        </button>
        <DiffStat additions={diff.additions} deletions={diff.deletions} />
        {sessionId ? (
          <button
            type="button"
            className="p-[3px] text-muted-foreground"
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
          {diff.binary ? (
            <p className="m-0 px-3 py-2 border-t border-subtle text-muted-foreground text-[11px]">
              Binary file; no text diff to show.
            </p>
          ) : null}
          {diff.patch ? <PatchBody patch={diff.patch} path={diff.path} /> : null}
          {!diff.patch && !diff.binary ? (
            <p className="m-0 px-3 py-2 border-t border-subtle text-muted-foreground text-[11px]">
              {diff.truncated ? 'This file is too large to show here.' : 'No line changes.'}
            </p>
          ) : null}
          {diff.truncated && diff.patch ? (
            <p className="m-0 px-3 py-2 border-t border-subtle text-muted-foreground text-[11px]">
              This diff was cut short. Open it in the editor to see it all.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
const STATUS_LETTERS: Record<FileDiff['kind'], string> = {
  add: 'A',
  update: 'M',
  delete: 'D',
  rename: 'R',
};
const BADGES: Record<string, [type: string, label: string]> = {
  ts: ['ts', 'TS'],
  tsx: ['ts', 'TSX'],
  mts: ['ts', 'TS'],
  cts: ['ts', 'TS'],
  js: ['js', 'JS'],
  jsx: ['js', 'JSX'],
  mjs: ['js', 'JS'],
  cjs: ['js', 'JS'],
  json: ['json', '{ }'],
  md: ['md', 'M↓'],
  css: ['css', '#'],
  scss: ['css', '#'],
};
function FileBadge({ path }: { path: string }) {
  const [type, label] = BADGES[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? ['', ''];
  return (
    <span className="change-review-badge" data-type={type} aria-hidden="true">
      {label || <Icon name="file" size={13} />}
    </span>
  );
}
/** The checkout's changed files. VS Code's own diff editors render the content. */
export function ChangesView({
  result,
  sessionId = '',
  session,
  loading,
  onRefresh,
}: {
  result?: ChangesResult;
  sessionId?: string;
  session?: Session;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [threadOnly, setThreadOnly] = useState(false);
  const [selected, setSelected] = useState('');
  const [limit, setLimit] = useState(200);
  const normalize = (file: string) =>
    result?.root && file.startsWith(`${result.root}/`) ? file.slice(result.root.length + 1) : file;
  const evidence = new Set(
    session?.messages.flatMap(
      (message) =>
        message.tool?.diffs?.flatMap((diff) => [
          normalize(diff.path),
          ...(diff.original ? [normalize(diff.original)] : []),
        ]) ?? [],
    ) ?? [],
  );
  const all = result?.files ?? [];
  const files = all.filter(
    (file) =>
      (!threadOnly ||
        !session ||
        evidence.has(file.path) ||
        Boolean(file.original && evidence.has(file.original))) &&
      file.path.toLowerCase().includes(query.toLowerCase()),
  );
  const totals = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return (
    <div className="change-review min-w-0">
      <div className="change-review-toolbar">
        <span className="change-review-count">
          {loading && !result ? 'Reading changes…' : `${files.length} files`}
        </span>
        <DiffStat {...totals} />
        <span className="change-review-actions">
          <button
            type="button"
            className="change-review-primary"
            title="Open every changed file in VS Code's multi-file diff editor"
            disabled={!all.length}
            onClick={() => send({ type: 'reviewChanges', id: sessionId })}
          >
            Review all
          </button>
          <button
            type="button"
            className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground"
            aria-label="Refresh changes"
            title="Refresh"
            onClick={onRefresh}
            disabled={loading}
          >
            <Icon name="refresh" size={13} />
          </button>
        </span>
      </div>
      <p className="change-review-caption">
        {result?.baseline ? `${result.baseline.slice(0, 7)} (HEAD)` : 'Empty repository'} ↔ working
        tree
      </p>
      <div className="change-review-filters">
        <input
          aria-label="Search changed files"
          placeholder="Filter files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="change-review-search"
        />
        <label
          className="change-review-scope"
          title="Files recorded during this thread, including provider reports. Coverage may be incomplete."
        >
          <input
            type="checkbox"
            checked={threadOnly && Boolean(session)}
            disabled={!session}
            onChange={(event) => setThreadOnly(event.target.checked)}
          />
          This thread
        </label>
      </div>
      {threadOnly && session && !evidence.size ? (
        <p className="change-review-note">No recorded file evidence in this thread.</p>
      ) : null}
      {result?.error ? (
        <p className="change-review-note" role="alert">
          {result.error}
        </p>
      ) : null}
      {!loading && result && !result.error && !files.length ? (
        <p className="change-review-note">
          {query || threadOnly
            ? 'No matching changed files.'
            : 'No uncommitted changes in this checkout.'}
        </p>
      ) : null}
      <div className="change-review-list">
        {files.slice(0, limit).map((file) => {
          const directory = file.path.includes('/')
            ? file.path.slice(0, file.path.lastIndexOf('/'))
            : '';
          return (
            <button
              key={file.path}
              type="button"
              aria-label={`Show ${file.path} in the Changes editor`}
              aria-pressed={selected === file.path}
              title={file.original ? `${file.original} → ${file.path}` : file.path}
              className="change-review-file"
              data-kind={file.kind}
              onClick={() => {
                setSelected(file.path);
                send({ type: 'reviewChanges', id: sessionId, file: file.path });
              }}
            >
              <FileBadge path={file.path} />
              <span className="change-review-name">{file.path.split('/').at(-1)}</span>
              <span className="change-review-directory">{directory}</span>
              {file.binary ? (
                <span className="change-review-muted">Binary</span>
              ) : file.truncated ? (
                <span className="change-review-muted">Large</span>
              ) : (
                <DiffStat additions={file.additions} deletions={file.deletions} />
              )}
              <span
                className="change-review-status"
                data-kind={file.kind}
                title={KIND_LABELS[file.kind] || 'Modified'}
              >
                {STATUS_LETTERS[file.kind]}
              </span>
            </button>
          );
        })}
        {files.length > limit ? (
          <button
            type="button"
            className="change-review-file change-review-muted"
            onClick={() => setLimit(limit + 200)}
          >
            Show {Math.min(200, files.length - limit)} more
          </button>
        ) : null}
      </div>
    </div>
  );
}
