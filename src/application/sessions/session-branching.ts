import type { Message, Session } from '../../shared/model';
import { ForeignTurnError, turnEnd } from './native-position';

function userBefore(messages: Message[], index: number): number {
  for (let at = index; at >= 0; at--) if (messages[at].role === 'user') return at;
  return -1;
}

/** A turn from an earlier agent can't be resumed by the current one; say what to do instead. */
function foreign<T>(read: () => T, what: 'forked' | 'rewound'): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof ForeignTurnError)) throw error;
    throw new Error(
      what === 'forked'
        ? `${error.message} Start a new chat with its context instead.`
        : `${error.message} Edit a message sent since the switch, or start a new chat with its context.`,
    );
  }
}

export interface ForkPoint {
  /** The local rows the branch starts with: every turn up to and including this one. */
  messages: Message[];
  /** Kept up to this turn's end in the CLI's own session. */
  from: { nativeId: string; at: string };
}

/** A branch keeps whole turns, since that is what each CLI can resume at. */
export function forkPoint(session: Session, messageId: string): ForkPoint {
  const { messages } = session;
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) throw new Error('That message is no longer in this thread.');
  const start = userBefore(messages, index);
  if (start === -1) throw new Error('Fork from a reply that follows one of your messages.');
  let end = start + 1;
  while (end < messages.length && messages[end].role !== 'user') end += 1;
  const from = foreign(() => turnEnd(session, messages, start), 'forked');
  if (!from)
    throw new Error(
      'This turn has no saved position in the CLI, so it can’t be forked. Start a new chat with its context instead.',
    );
  return { messages: messages.slice(0, end), from };
}

export interface RewindPoint {
  /** Rows kept: everything before the message you are editing. */
  keep: number;
  /** The previous turn's end, or undefined when the edit replaces the first message. */
  from?: { nativeId: string; at: string };
}

/** Editing your message drops it and everything after; the CLI keeps up to the turn before. */
export function rewindPoint(session: Session, messageId: string): RewindPoint {
  const { messages } = session;
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) throw new Error('That message is no longer in this thread.');
  if (messages[index].role !== 'user') throw new Error('Only your own messages can be edited.');
  const previous = userBefore(messages, index - 1);
  if (previous === -1) return { keep: index };
  const from = foreign(() => turnEnd(session, messages, previous), 'rewound');
  if (!from)
    throw new Error(
      'The turn before this message has no saved position in the CLI, so the thread can’t be rewound here.',
    );
  return { keep: index, from };
}
