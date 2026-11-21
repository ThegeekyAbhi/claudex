import { useEffect, useRef, useState } from 'react';
import { profileLabel } from '../../../../../shared/model';
import type { PageConversation, PageViewState } from '../../../../../shared/protocol/pages';
import { AgentMark, Icon } from '../../../../components/icons';
import { Hint, Menu } from '../../../../components/menus';
import { MarkdownText } from '../../../../lib/markdown';
import { cn } from '../../../../lib/utils';
import { post } from '../../shared/page-bridge';
import { SmallButton } from '../../shared/small-button';
import { useElapsed } from './use-elapsed';

const THREAD_STATE: Record<string, string> = {
  running: 'Working',
  waiting: 'Needs you',
  completed: 'Finished',
  failed: 'Failed',
  interrupted: 'Stopped',
  idle: 'Not started',
};
const WAITING_FOR: Record<NonNullable<PageConversation['waitingFor']>, string> = {
  approval: 'needs your approval',
  question: 'has a question for you',
  plan: 'has a plan ready for you',
};

/**
 * The page's chat: a message to an agent about this page, and the conversation that follows,
 * here in the page. Approvals and questions are answered in the Claudex chat, which it links to.
 */
export function PageChat({
  state,
  prompt,
  setPrompt,
  box,
  profile,
  setProfile,
  mode,
  setMode,
  onAsk,
  reveal,
}: {
  state?: PageViewState;
  prompt: string;
  setPrompt: (value: string) => void;
  box: React.RefObject<HTMLTextAreaElement | null>;
  profile?: string;
  setProfile: (value: string) => void;
  mode: 'ask' | 'auto';
  setMode: (value: 'ask' | 'auto') => void;
  onAsk: () => void;
  /** Changes when something else asked an agent, to open the chat on its reply. */
  reveal: number;
}) {
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const conversation = state?.conversation;
  const running = conversation?.status === 'running';
  const elapsed = useElapsed(running ? conversation?.startedAt : undefined);
  const lastText = conversation?.messages.at(-1)?.text;
  // Follow the reply as it streams, unless you scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new text is the trigger
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lastText, conversation?.messages.length, open]);
  useEffect(() => {
    if (!reveal) return;
    pinned.current = true;
    setOpen(true);
  }, [reveal]);
  if (!state) return null;

  const canWrite = state.trusted && state.agents.length > 0;
  const replying = Boolean(conversation && !running && conversation.status !== 'waiting');
  const send = () => {
    const clean = prompt.trim();
    if (!clean || !canWrite) return;
    pinned.current = true;
    setOpen(true);
    if (conversation && replying) {
      post({ type: 'pageReply', threadId: conversation.id, prompt: clean });
      setPrompt('');
    } else if (!conversation) onAsk();
  };
  const threads = state.threads;
  const agent = state.agents.find((item) => item.id === profile);

  const expanded = open && conversation;
  return (
    <section
      aria-label="Work with this page"
      className={cn(
        'page-chat fixed right-4 bottom-4 z-20 flex flex-col rounded-2xl border border-subtle bg-overlay shadow-md',
        expanded
          ? 'h-[min(480px,calc(100%-32px))] w-[min(520px,calc(100%-32px))]'
          : 'w-[min(440px,calc(100%-32px))]',
      )}
    >
      <header className="page-chat-header relative flex items-center gap-1 px-3 py-2">
        {expanded ? (
          <Hint label="Collapse">
            <button
              type="button"
              aria-label="Collapse the chat"
              onClick={() => setOpen(false)}
              className="grid size-7 shrink-0 place-items-center rounded-full text-faint hover:bg-muted hover:text-muted-foreground"
            >
              <Icon name="chevronDown" size={14} />
            </button>
          </Hint>
        ) : null}
        <div className="min-w-0 flex-1">
          <Menu
            label={conversation ? conversation.title : 'New chat'}
            ariaLabel="Chat"
            className="w-full min-w-0 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left [&>svg]:shrink-0"
            title={conversation?.title}
            icon={conversation ? <AgentMark agent={conversation.agent} size={12} /> : undefined}
            heading="Chats about this page"
            items={[
              {
                key: 'new',
                label: 'New chat',
                icon: <Icon name="plus" size={12} />,
                selected: !conversation,
                onSelect: () => {
                  post({ type: 'pageThread' });
                  setOpen(false);
                  requestAnimationFrame(() => box.current?.focus());
                },
              },
              ...threads.map((thread) => ({
                key: thread.id,
                label: thread.title,
                description: THREAD_STATE[thread.status],
                icon: <AgentMark agent={thread.agent} size={12} />,
                selected: thread.id === conversation?.id,
                onSelect: () => {
                  post({ type: 'pageThread', threadId: thread.id });
                  pinned.current = true;
                  setOpen(true);
                },
              })),
            ]}
          />
        </div>
        {conversation && !expanded ? (
          <Hint label="Expand chat">
            <button
              type="button"
              aria-label="Expand chat"
              aria-expanded={false}
              onClick={() => setOpen(true)}
              className="grid size-7 shrink-0 place-items-center rounded-full text-faint hover:bg-muted hover:text-muted-foreground"
            >
              <Icon name="chevronUp" size={14} />
            </button>
          </Hint>
        ) : null}
        {conversation ? (
          <Hint label="Open in the Claudex chat">
            <button
              type="button"
              aria-label="Open in the Claudex chat"
              onClick={() => post({ type: 'openChat', id: conversation.id })}
              className="grid size-7 shrink-0 place-items-center rounded-full text-faint hover:bg-muted hover:text-muted-foreground"
            >
              <Icon name="external" size={13} />
            </button>
          </Hint>
        ) : null}
      </header>
      {expanded && conversation ? (
        <div
          ref={scroller}
          onScroll={(event) => {
            const element = event.currentTarget;
            pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          }}
          className="page-chat-messages min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-3"
        >
          {conversation.messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="my-3 flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-3.5 py-2 text-[13px] leading-[1.55]">
                  {message.text}
                </div>
              </div>
            ) : message.role === 'image' && message.image ? (
              <figure key={message.id} className="page-chat-image my-2">
                {state.imageBase ? (
                  <img
                    src={`${state.imageBase}${message.image.file}`}
                    alt={message.image.prompt ?? 'An image the agent made'}
                    className="max-h-[220px] w-full rounded-lg border border-subtle object-contain"
                  />
                ) : null}
                <figcaption className="mt-1 flex items-center gap-2 text-[12px] text-faint">
                  <span className="min-w-0 flex-1 truncate" title={message.image.prompt}>
                    {message.image.prompt}
                  </span>
                  {state.id ? (
                    <SmallButton
                      onClick={() =>
                        message.image &&
                        post({
                          type: 'pageAddChatImage',
                          file: message.image.file,
                          ...(message.image.prompt
                            ? { alt: message.image.prompt.slice(0, 200) }
                            : {}),
                        })
                      }
                    >
                      Add to page
                    </SmallButton>
                  ) : null}
                </figcaption>
              </figure>
            ) : message.role === 'tool' ? (
              <div
                key={message.id}
                className="my-1 flex items-center gap-2 text-[12px] text-faint"
                title={message.text}
              >
                {message.status === 'running' ? (
                  <span className="spinner inline-block size-2 shrink-0 animate-spinner rounded-full border-[1.5px] border-strong border-t-foreground motion-reduce:animate-none" />
                ) : (
                  <Icon name={message.status === 'failed' ? 'close' : 'check'} size={11} />
                )}
                <span className="truncate">{message.text}</span>
              </div>
            ) : (
              <div key={message.id} className="page-chat-reply my-2 text-[13px] leading-[1.6]">
                <MarkdownText
                  text={message.text}
                  streaming={running && message === conversation.messages.at(-1)}
                />
              </div>
            ),
          )}
          {running ? (
            <div className="mt-2 text-[12px] text-faint">
              {conversation.messages.at(-1)?.role === 'user' ? 'Thinking' : 'Working'}
              {elapsed ? ` for ${elapsed}s` : '…'}
            </div>
          ) : null}
          {conversation.waitingFor ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-subtle bg-surface px-3 py-2 text-[12.5px]">
              <span className="size-1.5 shrink-0 rounded-full bg-warning" />
              <span className="flex-1">
                {profileLabel(conversation.agent)} {WAITING_FOR[conversation.waitingFor]}.
              </span>
              <SmallButton strong onClick={() => post({ type: 'openChat', id: conversation.id })}>
                Open in chat
              </SmallButton>
            </div>
          ) : conversation.status === 'failed' || conversation.status === 'interrupted' ? (
            <div className="mt-2 text-[12px] text-faint">
              {conversation.status === 'failed' ? 'The turn failed.' : 'Stopped.'}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="page-chat-composer flex items-end gap-3 border-t border-subtle px-4 py-3">
        <textarea
          ref={box}
          rows={1}
          value={prompt}
          disabled={!canWrite || conversation?.status === 'waiting'}
          placeholder={
            !state.trusted
              ? 'Trust this workspace to work with agents'
              : !state.agents.length
                ? 'Set up Claude Code or Codex to work with agents'
                : conversation?.status === 'waiting'
                  ? 'Answer in the Claudex chat to continue'
                  : running
                    ? 'Working…'
                    : conversation
                      ? 'Reply…'
                      : 'Work with this page…'
          }
          aria-label="Message to an agent about this page"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!running) send();
            }
          }}
          className="max-h-[160px] min-h-[30px] min-w-0 flex-1 resize-none bg-transparent py-[6px] text-[13px] leading-[18px] outline-none [field-sizing:content] placeholder:text-faint"
        />
        {running && conversation ? (
          <Hint label="Stop">
            <button
              type="button"
              aria-label="Stop"
              onClick={() => post({ type: 'pageStop', threadId: conversation.id })}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <span className="size-2.5 rounded-[2px] bg-primary-foreground" />
            </button>
          </Hint>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!prompt.trim() || !canWrite || conversation?.status === 'waiting'}
            onClick={send}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-faint"
          >
            <Icon name="arrow" size={14} />
          </button>
        )}
      </div>
      {!conversation ? (
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          {state.agents.length ? (
            <Menu
              label={agent?.label ?? 'Agent'}
              ariaLabel="Agent"
              icon={profile ? <AgentMark agent={profile} size={12} /> : undefined}
              heading="Agent"
              items={state.agents.map((item) => ({
                key: item.id,
                label: item.label,
                icon: <AgentMark agent={item.id} size={12} />,
                selected: item.id === profile,
                onSelect: () => setProfile(item.id),
              }))}
            />
          ) : null}
          <Menu
            label={mode === 'ask' ? 'Ask' : 'Auto'}
            ariaLabel="Mode"
            heading="Mode"
            items={[
              {
                key: 'auto',
                label: 'Auto',
                description: 'Works and suggests edits to the page',
                selected: mode === 'auto',
                onSelect: () => setMode('auto'),
              },
              {
                key: 'ask',
                label: 'Ask',
                description: 'Answers only, changes nothing',
                selected: mode === 'ask',
                onSelect: () => setMode('ask'),
              },
            ]}
          />
          <span className="flex-1 truncate px-1 text-[11px] text-faint">
            Edits arrive as suggestions
          </span>
        </div>
      ) : null}
    </section>
  );
}
