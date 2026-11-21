import type { Session, Snapshot } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';

export type PanelTab = 'docs';

const PLAN_STATUS = { ready: 'ready', incomplete: 'unfinished', approved: 'built' } as const;
/** Every thread's saved plan, newest first, so an earlier plan is one click away. */
function PlansList({ sessions }: { sessions: Session[] }) {
  const plans = sessions
    .filter((session) => session.plan?.file && session.plan.status !== 'drafting')
    .sort((a, b) => (b.plan?.updatedAt ?? 0) - (a.plan?.updatedAt ?? 0))
    .slice(0, 30);
  if (!plans.length) return null;
  return (
    <div className="plans-list mt-2 border-t border-subtle px-2 pt-3">
      <span className="block text-[11px] font-[450] text-faint mx-2 mb-[3px]">Thread plans</span>
      {plans.map((session) => (
        <button
          type="button"
          key={session.id}
          className="w-full justify-start gap-1.5 text-[12px] px-2 py-1 min-w-0"
          title={`Open the plan from “${session.title}”`}
          onClick={() => send({ type: 'viewPlan', id: session.id })}
        >
          <Icon name="plan" size={13} />
          <span className="truncate">{session.title}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {session.plan && session.plan.status !== 'drafting'
              ? PLAN_STATUS[session.plan.status]
              : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
export function SidePanel({
  snapshot,
  session,
  onClose,
  onLinkThread,
}: {
  snapshot: Snapshot;
  session?: Session;
  onClose: () => void;
  onLinkThread: () => void;
}) {
  return (
    <aside
      className="border-l border-strong bg-surface flex flex-col min-h-0 min-w-0 overflow-y-auto max-[900px]:absolute max-[900px]:right-0 max-[900px]:top-10 max-[900px]:bottom-0 max-[900px]:w-[min(420px,100%)] max-[900px]:z-25 max-[900px]:shadow-[-12px_0_24px_#0003]"
      aria-label="Documents"
    >
      <div className="flex items-center justify-between pr-1.5 pl-3 h-10 border-b border-subtle shrink-0">
        <h2 className="m-0 text-[12.5px] font-semibold text-foreground">Docs</h2>
        <button
          type="button"
          className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground"
          aria-label="Close panel"
          onClick={onClose}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
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
      <PlansList sessions={snapshot.sessions} />
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
    </aside>
  );
}
