import type { ToolInfo } from '../../../shared/model';
import { Icon } from '../../components/icons';

export function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-flex text-muted-foreground transition-transform duration-[120ms] ease-[ease] [&.open]:rotate-90 motion-reduce:transition-none ${open ? 'open' : ''}`}
    >
      <Icon name="chevron" size={11} />
    </span>
  );
}
export function StepState({ status }: { status: ToolInfo['status'] }) {
  if (status === 'running')
    return (
      <span
        className="spinner size-[11px] shrink-0 inline-block rounded-full border-[1.5px] border-strong border-t-foreground animate-spinner motion-reduce:animate-none"
        role="img"
        aria-label="Running"
      />
    );
  if (status === 'failed')
    return (
      <span
        className="inline-flex shrink-0 [&.done]:text-success [&.failed]:text-error [&.declined]:text-warning failed"
        role="img"
        aria-label="Failed"
      >
        <Icon name="x" size={12} />
      </span>
    );
  if (status === 'interrupted')
    return (
      <span role="img" aria-label="Interrupted" className="text-warning">
        <Icon name="stop" size={12} />
      </span>
    );
  if (status === 'declined')
    return (
      <span
        className="inline-flex shrink-0 [&.done]:text-success [&.failed]:text-error [&.declined]:text-warning declined"
        role="img"
        aria-label="Declined"
      >
        <Icon name="x" size={12} />
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 [&.done]:text-success [&.failed]:text-error [&.declined]:text-warning done"
      role="img"
      aria-label="Done"
    >
      <Icon name="check" size={12} />
    </span>
  );
}
