import { memo, useMemo, useState } from 'react';
import { parsePatch } from '../../../shared/domain/diff';
import type { FileDiff } from '../../../shared/model';
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
