import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import { Menu } from '../../components/menus';
import type { ComposerProps } from './types';
import type { useComposer } from './use-composer';

export function ComposerCaption({
  session,
  choice,
  onChoice,
  onDismissNudge,
  nudge,
  focusInput,
  menuSide,
  selectMode,
  worktree,
}: Pick<ComposerProps, 'session' | 'choice' | 'onChoice' | 'onDismissNudge'> &
  Pick<
    ReturnType<typeof useComposer>,
    'nudge' | 'focusInput' | 'menuSide' | 'selectMode' | 'worktree'
  >) {
  return (
    <div className="composer-caption flex items-center justify-between gap-3 text-muted-foreground text-[10.5px] max-w-[780px] mt-1.5 mx-auto mb-0 [&>span]:truncate max-[480px]:[&>span:last-child]:hidden">
      <Menu
        label={worktree ? 'Worktree' : 'Local'}
        icon={<Icon name="branch" size={12} />}
        ariaLabel={`Location: ${worktree ? 'worktree' : 'local checkout'}`}
        className="min-h-5 px-1 py-[3px] text-[10.5px]"
        side={menuSide}
        onClosed={focusInput}
        heading="Where it works"
        items={
          session
            ? [
                {
                  key: 'current',
                  label: worktree ? 'This worktree' : 'Local checkout',
                  description: session.cwd,
                  selected: true,
                  onSelect: () => {},
                },
                {
                  key: 'worktree',
                  label: 'Continue in a new worktree',
                  description: 'Opens a linked thread from committed HEAD',
                  onSelect: () => send({ type: 'worktree', id: session.id }),
                },
              ]
            : [
                {
                  key: 'local',
                  label: 'Local checkout',
                  description: 'Works in your open folder',
                  selected: !choice.worktree,
                  onSelect: () => onChoice({ ...choice, worktree: false }),
                },
                {
                  key: 'worktree',
                  label: 'New worktree',
                  description: 'Starts from committed HEAD',
                  selected: Boolean(choice.worktree),
                  onSelect: () => onChoice({ ...choice, worktree: true }),
                },
              ]
        }
      />
      {nudge ? (
        <output className="inline-flex items-center gap-[5px] px-2 py-px border border-subtle rounded-full text-[10.5px] text-muted-foreground [&_kbd]:text-[10.5px] [&_kbd]:text-faint">
          {nudge.kind === 'plan' ? (
            <button
              type="button"
              className="cursor-pointer bg-transparent p-0 text-inherit"
              onClick={() => selectMode('plan')}
            >
              {nudge.text} <kbd>⇧Tab</kbd>
            </button>
          ) : (
            <span>{nudge.text}</span>
          )}
          {nudge.kind === 'handoff' && session ? (
            <button
              type="button"
              className="cursor-pointer bg-transparent p-0 text-[var(--link)] hover:underline"
              onClick={() => send({ type: 'handoff', id: session.id })}
            >
              Hand off
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Dismiss: ${nudge.text}`}
            className="cursor-pointer bg-transparent p-0 opacity-60 hover:opacity-100"
            onClick={() => onDismissNudge(nudge.key)}
          >
            <Icon name="close" size={10} />
          </button>
        </output>
      ) : (
        <span />
      )}
    </div>
  );
}
