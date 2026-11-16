import { createContext, type ReactNode, useContext } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentKind, Message } from '../../../shared/model';
import { Icon, type IconName } from '../../components/icons';

/** What a message's actions can do in this thread. Absent where they don't apply, such as workers. */
export interface MessageActionHandlers {
  /** Unset while the thread is busy, or can't branch (observed, in a terminal). */
  fork?: (message: Message) => void;
  edit?: (message: Message) => void;
  newChat?: (message: Message, agent: AgentKind) => void;
  quote: (text: string) => void;
  /** Agents a new chat can start with, this thread's own first. */
  agents: { id: AgentKind; label: string }[];
}
export const MessageActionsContext = createContext<MessageActionHandlers | null>(null);

export function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="message-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/** Selected text inside this message, or all of it. */
function quotedText(element: HTMLElement | null, text: string): string {
  const selection = window.getSelection();
  const picked = selection?.toString().trim();
  if (picked && element && selection?.anchorNode && element.contains(selection.anchorNode))
    return picked;
  return text;
}

/** Copy, then whatever this message allows: branch, carry over, quote, or edit. */
export function MessageActions({
  message,
  copy,
  own,
}: {
  message: Message;
  copy: ReactNode;
  /** Your message, which can be edited; replies can be forked or carried to a new chat. */
  own?: boolean;
}) {
  const actions = useContext(MessageActionsContext);
  if (!actions) return <div className="message-actions">{copy}</div>;
  const quote = (event: React.MouseEvent<HTMLButtonElement>) =>
    actions.quote(quotedText(event.currentTarget.closest('article'), message.text));
  return (
    <div className="message-actions">
      {copy}
      <button
        type="button"
        className="message-action"
        aria-label="Quote in reply"
        title="Quote in reply"
        onClick={quote}
      >
        <Icon name="quote" size={15} />
      </button>
      {own ? (
        <ActionButton
          icon="edit"
          label={actions.edit ? 'Edit and resend from here' : 'Stop the turn before editing'}
          disabled={!actions.edit}
          onClick={() => actions.edit?.(message)}
        />
      ) : (
        <>
          <ActionButton
            icon="fork"
            label={
              actions.fork ? 'Fork: new thread from this turn' : 'Stop the turn before forking'
            }
            disabled={!actions.fork}
            onClick={() => actions.fork?.(message)}
          />
          {actions.newChat ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="message-action"
                  aria-label="New chat with context up to here"
                  title="New chat with context up to here"
                >
                  <Icon name="newChat" size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="bg-overlay text-foreground border border-strong z-40 rounded-lg shadow-md min-w-[200px] p-1"
                side="bottom"
                align="start"
                sideOffset={4}
                collisionPadding={8}
              >
                <DropdownMenuLabel className="pt-[5px] px-[7px] pb-[3px] text-[11px] text-faint">
                  New chat with context up to here
                </DropdownMenuLabel>
                {actions.agents.map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    className="menu-item flex items-center gap-2 min-h-[26px] px-2 py-1 rounded-[5px] cursor-pointer text-[12px] outline-none data-highlighted:bg-muted"
                    onSelect={() => actions.newChat?.(message, agent.id)}
                  >
                    {agent.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      )}
    </div>
  );
}
