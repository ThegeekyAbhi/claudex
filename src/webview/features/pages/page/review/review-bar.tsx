import { useState } from 'react';
import { editFits, type PageSuggestion, profileLabel } from '../../../../../shared/model';
import { AgentMark, Icon } from '../../../../components/icons';
import { Hint } from '../../../../components/menus';
import { post } from '../../shared/page-bridge';
import { SmallButton } from '../../shared/small-button';

/**
 * Suggested edits are reviewed where they apply in the page. This bar says what's waiting, steps
 * through the changes, and accepts or rejects them all; edits that no longer fit are listed here.
 */
export function ReviewBar({
  suggestions,
  text,
  onShow,
  onAll,
}: {
  suggestions: PageSuggestion[];
  text: string;
  onShow: (key: string) => void;
  onAll: (accept: boolean) => void;
}) {
  const [at, setAt] = useState(0);
  const changes = suggestions.flatMap((suggestion) =>
    suggestion.edits.map((edit, index) => ({
      key: `${suggestion.id}:${index}`,
      suggestion,
      index,
      fits: editFits(text, edit),
    })),
  );
  const placed = changes.filter((change) => change.fits);
  const stale = changes.filter((change) => !change.fits);
  const agents = [...new Set(suggestions.map((suggestion) => profileLabel(suggestion.agent)))];
  const note = suggestions.length === 1 ? suggestions[0].note : undefined;
  const threadId = suggestions.find((suggestion) => suggestion.threadId)?.threadId;
  const step = (delta: number) => {
    if (!placed.length) return;
    const next = (at + delta + placed.length) % placed.length;
    setAt(next);
    onShow(placed[next].key);
  };
  return (
    <section
      aria-label="Suggested changes"
      className="page-review-bar sticky top-3 z-10 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-subtle bg-overlay py-1.5 pr-1.5 pl-3 text-[12.5px] shadow-md"
    >
      <AgentMark agent={suggestions[0].agent} size={13} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        <span className="text-foreground">{agents.join(' and ')}</span> suggested{' '}
        {placed.length === 1 ? 'a change' : `${placed.length} changes`}
        {note ? ` · ${note}` : ''}
      </span>
      {placed.length > 1 ? (
        <span className="flex items-center text-faint">
          <Hint label="Previous change">
            <button
              type="button"
              aria-label="Previous change"
              onClick={() => step(-1)}
              className="grid size-6 place-items-center rounded-md hover:bg-muted hover:text-foreground"
            >
              <Icon name="chevronUp" size={12} />
            </button>
          </Hint>
          <span className="min-w-[34px] text-center tabular-nums text-[11.5px]">
            {Math.min(at + 1, placed.length)}/{placed.length}
          </span>
          <Hint label="Next change">
            <button
              type="button"
              aria-label="Next change"
              onClick={() => step(1)}
              className="grid size-6 place-items-center rounded-md hover:bg-muted hover:text-foreground"
            >
              <Icon name="chevronDown" size={12} />
            </button>
          </Hint>
        </span>
      ) : placed.length === 1 ? (
        <SmallButton onClick={() => onShow(placed[0].key)}>Show</SmallButton>
      ) : null}
      {threadId ? (
        <SmallButton onClick={() => post({ type: 'openChat', id: threadId })}>Chat</SmallButton>
      ) : null}
      <span className="mx-0.5 h-4 w-px bg-strong" />
      <SmallButton onClick={() => onAll(false)}>Reject all</SmallButton>
      <SmallButton strong disabled={!placed.length || stale.length > 0} onClick={() => onAll(true)}>
        Accept all
      </SmallButton>
      {stale.length ? (
        <div className="flex w-full items-center gap-2 border-t border-subtle pt-1.5 text-[12px] text-warning">
          <span className="flex-1">
            {stale.length === 1
              ? 'One change no longer fits the page, since it changed.'
              : `${stale.length} changes no longer fit the page, since it changed.`}
          </span>
          <SmallButton
            onClick={() => {
              for (const change of stale)
                post({
                  type: 'pageSuggestion',
                  id: change.suggestion.id,
                  accept: false,
                  index: change.index,
                });
            }}
          >
            Dismiss
          </SmallButton>
        </div>
      ) : null}
    </section>
  );
}
