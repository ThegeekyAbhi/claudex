import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';

/** Stands in for the composer while a thread runs in the CLI, so there's one place to write. */
export function TerminalStrip({ id, label }: { id: string; label: string }) {
  return (
    <div className="composer-area pt-2 px-6 pb-2.5 shrink-0 max-[900px]:py-2 max-[900px]:px-3">
      <output className="flex flex-wrap items-center gap-2 max-w-[780px] m-auto px-3 py-2 border border-composer-edge rounded-lg bg-raised text-[12px]">
        <Icon name="terminal" size={14} />
        <span className="flex-1 min-w-40 text-muted-foreground">
          Continuing in the {label} terminal. New messages appear here when you close it.
        </span>
        <button
          type="button"
          className="px-2 py-1 text-[12px] text-foreground border border-strong rounded-md"
          onClick={() => send({ type: 'terminal', id })}
        >
          Show terminal
        </button>
        <button
          type="button"
          className="px-2 py-1 text-[12px] text-foreground border border-strong rounded-md"
          onClick={() => send({ type: 'terminalBack', id })}
        >
          Back to chat
        </button>
      </output>
    </div>
  );
}
