import type { ChangesResult, Session, Snapshot } from '../../../core/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import { ChangesView } from './diff-view';

export type PanelTab = 'changes' | 'docs';
export function SidePanel({
  snapshot,
  session,
  tab,
  onTab,
  onClose,
  changes,
  changesLoading,
  onRefreshChanges,
  onLinkThread,
}: {
  snapshot: Snapshot;
  session?: Session;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  changes?: ChangesResult;
  changesLoading: boolean;
  onRefreshChanges: () => void;
  onLinkThread: () => void;
}) {
  return (
    <aside
      className="border-l border-strong bg-surface flex flex-col min-h-0 min-w-0 overflow-y-auto max-[900px]:absolute max-[900px]:right-0 max-[900px]:top-10 max-[900px]:bottom-0 max-[900px]:w-[min(420px,100%)] max-[900px]:z-25 max-[900px]:shadow-[-12px_0_24px_#0003]"
      aria-label="Changes and documents"
    >
      <div className="flex items-center justify-between pr-1.5 pl-2 h-10 border-b border-subtle shrink-0">
        <div
          className="flex gap-0.5 [&_button]:px-2 [&_button]:py-[3px] [&_button]:text-[12px] [&_button]:text-muted-foreground [&_.selected]:text-foreground [&_.selected]:bg-muted"
          role="tablist"
        >
          {(['changes', 'docs'] as const).map((value) => (
            <button
              type="button"
              role="tab"
              key={value}
              aria-selected={tab === value}
              className={tab === value ? 'selected' : ''}
              onClick={() => onTab(value)}
            >
              {value === 'changes' ? 'Changes' : 'Docs'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
          aria-label="Close panel"
          onClick={onClose}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      {tab === 'changes' ? (
        <ChangesView
          result={changes}
          sessionId={session?.id}
          loading={changesLoading}
          onRefresh={onRefreshChanges}
        />
      ) : (
        <>
          <div className="pt-3 px-4 pb-2">
            <span className="text-[11px] text-muted-foreground font-mono">docs/agent-work/</span>
          </div>
          <div className="px-2">
            {snapshot.documents.map((document) => (
              <div
                className="flex items-center [&>button:first-child]:min-w-0 [&>button:first-child]:flex-1 [&>button:first-child]:justify-start [&>button:first-child]:text-[12px] [&>button:first-child]:px-2 [&>button:first-child]:py-1 [&_span]:truncate"
                key={document.path}
              >
                <button
                  type="button"
                  title={`Preview ${document.name}`}
                  onClick={() => send({ type: 'document', path: document.path, preview: true })}
                >
                  <Icon name="file" size={13} />
                  <span>{document.name}</span>
                </button>
                <button
                  type="button"
                  className="text-muted-foreground p-1"
                  aria-label={`Edit ${document.name}`}
                  title="Edit Markdown"
                  onClick={() => send({ type: 'document', path: document.path })}
                >
                  <Icon name="external" size={13} />
                </button>
              </div>
            ))}
            {!snapshot.documents.length ? (
              <p className="mx-2 mb-3 mt-0 text-muted-foreground text-[12px]">
                Plans and briefs written here by you or your agents appear automatically.
              </p>
            ) : null}
          </div>
          <div className="p-[12px_8px] mt-2 border-t border-subtle flex flex-col gap-0.5 [&>button]:justify-start [&>button]:text-[12px] [&>button]:text-muted-foreground [&>button]:px-2 [&>button]:py-1">
            <span className="block text-[11px] font-[450] text-faint mx-2 mb-[3px] truncate">
              Start a document
            </span>
            {(['plan', 'task', 'review', 'handoff'] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                disabled={!snapshot.trusted}
                onClick={() => send({ type: 'template', kind, id: session?.id })}
              >
                <Icon name="plus" size={13} />
                {kind === 'task' ? 'Task brief' : kind[0].toUpperCase() + kind.slice(1)}
              </button>
            ))}
          </div>
          {session && !session.observed ? (
            <div className="border-t border-subtle p-2 [&_button]:justify-start [&_button]:w-full [&_button]:text-[12px] [&_button]:text-muted-foreground [&_button]:px-2 [&_button]:py-1">
              <button type="button" onClick={onLinkThread}>
                <Icon name="branch" size={13} />
                Add a linked thread
              </button>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
