import type { Approval, Session } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import { AutoHelp } from '../../components/menus';
import { DiffCard } from '../changes/diff-view';

export function ApprovalForm({
  approval,
  sessionId,
  session,
}: {
  approval: Approval;
  sessionId: string;
  session?: Session;
}) {
  const transitioning = Boolean(session?.transition);
  // Already in Auto, this would be the same as Allow once.
  const eligible =
    session?.mode !== 'auto' &&
    approval.origin === 'provider' &&
    !approval.questions &&
    !approval.kind &&
    session?.nativeId &&
    !session.observed &&
    (session.provider !== 'codex' || session.nativeSettings?.approvalPolicy === 'on-request');
  const respond = (allowed: boolean) =>
    send({ type: 'approve', id: sessionId, requestId: approval.id, allowed, answers: {} });
  return (
    <section
      className="border border-strong rounded-lg bg-raised my-3.5 px-3 py-2.5 in-[.subagent]:mx-2 in-[.subagent]:mt-0 in-[.subagent]:mb-2 [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-[12.5px] [&_h2]:font-medium [&_h2]:mt-0 [&_h2]:mx-0 [&_h2]:mb-2 [&_pre]:border [&_pre]:border-subtle [&_pre]:bg-surface [&_pre]:px-3 [&_pre]:py-2.5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:font-mono [&_pre]:text-[11.5px] [&_pre]:leading-[1.55] [&_pre]:max-h-[200px] [&_pre]:my-2 [&_pre]:mx-0 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere"
      aria-label="Agent request"
    >
      <h2>
        <span className="status-dot size-1.5 rounded-full bg-muted-foreground shrink-0 inline-block [&.quiet]:bg-faint [&.quiet]:opacity-50 [&.waiting]:bg-warning [&.failed]:bg-error in-[.rail-item]:ml-auto waiting" />
        {approval.title}
      </h2>
      {approval.diffs?.map((diff) => (
        <DiffCard key={diff.path} diff={diff} />
      ))}
      {approval.detail ? <pre>{approval.detail}</pre> : null}
      {session?.transition ? (
        <output>{session.transition === 'stopping' ? 'Stopping…' : 'Resuming in Auto…'}</output>
      ) : null}
      <div className="flex flex-wrap justify-end gap-1.5 mt-2.5 [&>button]:border-strong [&>button]:px-3 [&>button]:py-1 [&>button]:text-[12px]">
        <button type="button" disabled={transitioning} onClick={() => respond(false)}>
          Decline
        </button>
        <button
          type="button"
          className="bg-primary text-primary-foreground enabled:hover:bg-accent-hover"
          disabled={transitioning}
          onClick={() => respond(true)}
        >
          Allow once
        </button>
        {eligible ? (
          <>
            <button
              type="button"
              className="bg-mode-auto text-mode-auto-foreground enabled:hover:opacity-90"
              disabled={transitioning}
              onClick={() =>
                send({
                  type: 'approve',
                  id: sessionId,
                  requestId: approval.id,
                  allowed: true,
                  auto: true,
                  answers: {},
                })
              }
            >
              <Icon name="autoMode" size={13} /> Allow in Auto
            </button>
            <AutoHelp
              text={
                session?.provider === 'codex'
                  ? 'Allows this request, then uses Codex Auto review from its next turn. Until then it may still ask.'
                  : 'Allows this request, then Claude Code Auto mode reviews what comes next and asks only when it needs to.'
              }
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
