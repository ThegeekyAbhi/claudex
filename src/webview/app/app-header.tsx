import { agentKind, agentLabel, profileLabel, runnableProfiles } from '../../shared/model';
import { Icon } from '../components/icons';
import { Hint, OverflowMenu } from '../components/menus';
import { threadSignal } from '../features/threads/tab-state';
import { ThreadTabs } from '../features/threads/thread-tabs';
import { send } from './bridge';
import type { useAppState } from './state';

export function AppHeader({
  host,
  tabs,
  threads,
  changes,
  turns,
  ui,
  threadsPane,
}: Pick<
  ReturnType<typeof useAppState>,
  'host' | 'tabs' | 'threads' | 'changes' | 'turns' | 'ui'
> & {
  /** In the wide layout, the thread list is a resizable pane that can be folded away. */
  threadsPane?: ReturnType<typeof useAppState>['layout']['threads'];
}) {
  const { snapshot } = host;
  const { session } = tabs.current;
  return (
    <header className="h-10 shrink-0 bg-chrome flex items-center">
      <ThreadTabs
        items={tabs.strip.items}
        activeKey={tabs.strip.activeKey}
        signalOf={(item) => threadSignal(item, threads.children, threads.seen)}
        onActivate={tabs.strip.activate}
        onClose={tabs.strip.close}
        onRename={(item) => send({ type: 'rename', id: item.id })}
      />
      <div className="flex shrink-0 items-center h-full pl-1 pr-2 border-b border-l border-subtle">
        <Hint label="New chat">
          <button
            type="button"
            className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
            aria-label="New chat"
            disabled={!snapshot.trusted}
            onClick={() => tabs.compose()}
          >
            <Icon name="plus" />
          </button>
        </Hint>
        <button
          type="button"
          className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0 hidden max-[900px]:inline-flex"
          aria-label="Toggle session history"
          title="Threads"
          aria-expanded={tabs.history.open}
          onClick={() => tabs.history.setOpen((value) => !value)}
        >
          <Icon name="history" />
        </button>
        {session && !session.observed && !tabs.accounts.active ? (
          <Hint
            label={
              session.inTerminal
                ? 'Show terminal'
                : session.nativeId
                  ? `Open in the ${agentLabel(session)} terminal`
                  : `Send ${agentLabel(session)} a message first, then this thread can open in its terminal`
            }
          >
            <span className="inline-flex">
              <button
                type="button"
                className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-pressed:text-foreground disabled:pointer-events-none disabled:opacity-50"
                aria-label="Open in terminal"
                aria-pressed={Boolean(session.inTerminal)}
                disabled={!session.nativeId}
                onClick={() => send({ type: 'terminal', id: session.id })}
              >
                <Icon name="terminal" />
              </button>
            </span>
          </Hint>
        ) : null}
        <Hint label="Changes">
          <button
            type="button"
            className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
            aria-label="Toggle changes"
            aria-expanded={changes.panel === 'changes'}
            onClick={() => changes.setPanel((value) => (value === 'changes' ? null : 'changes'))}
          >
            <Icon name="diff" />
          </button>
        </Hint>
        {threadsPane ? (
          <Hint label={threadsPane.collapsed ? 'Show threads' : 'Hide threads'}>
            <button
              type="button"
              className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground"
              aria-label="Toggle thread list"
              aria-expanded={!threadsPane.collapsed}
              onClick={threadsPane.toggle}
            >
              <Icon name="sidebar" />
            </button>
          </Hint>
        ) : null}
        <OverflowMenu
          items={[
            ...(session && !session.observed && !tabs.accounts.active
              ? [
                  ...(snapshot.preferences.crossAgentContext !== 'off'
                    ? runnableProfiles()
                        .map((profile) => profile.id)
                        .filter((kind) => kind !== agentKind(session))
                        .map((kind) => ({
                          key: `continue-${kind}`,
                          label: `Continue in ${profileLabel(kind)}`,
                          icon: <Icon name="swap" size={14} />,
                          onSelect: () => turns.continueIn(session, { agent: kind }),
                        }))
                    : []),
                  {
                    key: 'handoff',
                    label: 'Hand off to another agent',
                    icon: <Icon name="swap" size={14} />,
                    onSelect: () => send({ type: 'handoff', id: session.id }),
                  },
                ]
              : []),
            {
              key: 'docs',
              label: 'Documents',
              icon: <Icon name="file" size={14} />,
              onSelect: () => changes.setPanel('docs'),
            },
            {
              key: 'accounts',
              label: 'Accounts',
              icon: <Icon name="agent" size={14} />,
              onSelect: () => tabs.accounts.open(),
            },
            {
              key: 'skills',
              label: 'Skills',
              icon: <Icon name="wrench" size={14} />,
              onSelect: () => ui.skills.setOpen(true),
            },
            {
              key: 'appearance',
              label:
                snapshot.preferences.appearance === 'cursor'
                  ? 'Use editor theme colors'
                  : 'Use Cursor dark colors',
              icon: <Icon name="palette" size={14} />,
              onSelect: () =>
                send({
                  type: 'setAppearance',
                  appearance: snapshot.preferences.appearance === 'cursor' ? 'editor' : 'cursor',
                }),
            },
          ]}
        />
      </div>
    </header>
  );
}
