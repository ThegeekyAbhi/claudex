import type { ChangesResult, Session, Snapshot } from '../model';
import { send } from './bridge';
import { ChangesView } from './diff-view';
import { Icon } from './icons';

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
    <aside className="documents" aria-label="Changes and documents">
      <div className="documents-heading">
        <div className="tabs" role="tablist">
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
        <button type="button" className="icon-button" aria-label="Close panel" onClick={onClose}>
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
          <div className="document-section">
            <span className="folder-path">docs/agent-work/</span>
          </div>
          <div className="document-list">
            {snapshot.documents.map((document) => (
              <div className="document-row" key={document.path}>
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
                  className="edit-document"
                  aria-label={`Edit ${document.name}`}
                  title="Edit Markdown"
                  onClick={() => send({ type: 'document', path: document.path })}
                >
                  <Icon name="external" size={13} />
                </button>
              </div>
            ))}
            {!snapshot.documents.length ? (
              <p className="document-empty">
                Plans and briefs written here by you or your agents appear automatically.
              </p>
            ) : null}
          </div>
          <div className="template-actions">
            <span className="section-label">Start a document</span>
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
            <div className="parallel-note">
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
