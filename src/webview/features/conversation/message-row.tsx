import { memo, useState } from 'react';
import type { Message } from '../../../shared/model';
import { MarkdownText } from '../../lib/markdown';
import { AttachmentChip } from '../attachments/context-menu';
import { ImageMessage } from '../images/image-view';

export type Guides = { planning: string; explain: string };

/** What a guide added to a message beyond your words. */
function GuideDisclosures({ message, guides }: { message: Message; guides: Guides }) {
  return (
    <>
      {message.planningGuideVersion ? (
        <details className="mt-1 text-[11px] text-muted-foreground">
          <summary>Planning guide v{message.planningGuideVersion}</summary>
          <div className="markdown">
            <MarkdownText text={guides.planning.replace(/<[^>]+>/g, '')} />
          </div>
        </details>
      ) : null}
      {message.explainGuideVersion ? (
        <details className="mt-1 text-[11px] text-muted-foreground">
          <summary>Explanation guide v{message.explainGuideVersion}</summary>
          <div className="markdown">
            <MarkdownText text={guides.explain.replace(/<[^>]+>/g, '')} />
          </div>
        </details>
      ) : null}
    </>
  );
}
/** Who asked the agent on this card, and in exactly what words. */
export function SentPrompt({
  asker,
  agentName,
  text,
  message,
  guides,
}: {
  asker: string;
  agentName: string;
  text: string;
  message?: Message;
  guides: Guides;
}) {
  const [all, setAll] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 3;
  return (
    <div className="sent-prompt pt-1.5 px-3 pb-2 border-t border-subtle text-[12px]">
      <div className="text-[11px] text-muted-foreground mb-0.5">
        {asker} asked {agentName}
      </div>
      {message?.attachments?.length ? (
        <div className="flex flex-wrap items-start gap-1 pb-1">
          {message.attachments.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's attachments never change
            <AttachmentChip key={index} attachment={item} />
          ))}
        </div>
      ) : null}
      <div className={`whitespace-pre-wrap wrap-anywhere ${long && !all ? 'line-clamp-3' : ''}`}>
        {text}
      </div>
      {long ? (
        <button
          type="button"
          className="mt-0.5 p-0 text-[11px] text-muted-foreground enabled:hover:text-foreground"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      ) : null}
      {message ? <GuideDisclosures message={message} guides={guides} /> : null}
    </div>
  );
}
/** Your words, as sent. Long ones fold to a few lines, so a pasted prompt doesn't fill the view. */
function YourMessage({ message, guides }: { message: Message; guides: Guides }) {
  const [all, setAll] = useState(false);
  const long = message.text.length > 900 || message.text.split('\n').length > 12;
  return (
    <article
      aria-label="You said"
      className="user-message relative flex flex-col items-end mt-7 mb-4 first:mt-0 in-[.subagent-transcript]:items-stretch in-[.subagent-transcript]:my-2"
    >
      <div className="bubble w-fit max-w-[min(85%,560px)] px-3.5 py-2 rounded-2xl rounded-br-md bg-[color-mix(in_srgb,var(--accent)_12%,var(--raised))] text-foreground in-[.subagent-transcript]:max-w-none in-[.subagent-transcript]:w-auto in-[.subagent-transcript]:rounded-[8px] in-[.subagent-transcript]:text-[12px]">
        {message.attachments?.length ? (
          <div className="flex flex-wrap justify-end items-start gap-1 pb-1.5">
            {message.attachments.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's attachments never change
              <AttachmentChip key={index} attachment={item} />
            ))}
          </div>
        ) : null}
        <div className={`markdown said ${long && !all ? 'line-clamp-[12]' : ''}`}>
          <MarkdownText text={message.text} />
        </div>
        {long ? (
          <button
            type="button"
            className="mt-1 p-0 text-[11px] text-muted-foreground enabled:hover:text-foreground"
            onClick={() => setAll(!all)}
          >
            {all ? 'Show less' : 'Show all'}
          </button>
        ) : null}
        <GuideDisclosures message={message} guides={guides} />
      </div>
    </article>
  );
}
export const MessageRow = memo(function MessageRow({
  message,
  streaming,
  note,
  guides,
}: {
  message: Message;
  streaming?: boolean;
  /** A short update between steps, not the turn's answer, so it reads quieter. */
  note?: boolean;
  guides: Guides;
}) {
  const { role, text } = message;
  // Rows read from a terminal start under a divider, not a box.
  if (role === 'notice' && message.id.startsWith('terminal-run-'))
    return (
      <output className="terminal-divider flex items-center gap-2.5 my-5 text-[11px] text-muted-foreground before:content-[''] before:flex-1 before:h-px before:bg-subtle after:content-[''] after:flex-1 after:h-px after:bg-subtle">
        {text}
      </output>
    );
  if (role === 'notice')
    return (
      <output className="block text-[12px] bg-surface wrap-anywhere border border-subtle rounded-md my-2.5 px-3 py-2 text-muted-foreground">
        {text}
      </output>
    );
  if (role === 'image' && message.image) return <ImageMessage image={message.image} />;
  if (role === 'user') return <YourMessage message={message} guides={guides} />;
  return (
    <article
      className={`assistant ${note ? 'my-2' : 'my-3.5'} in-[.subagent-transcript]:my-2 in-[.subagent-transcript]:text-[12px]`}
    >
      <div className={note ? 'markdown note' : 'markdown reply'}>
        <MarkdownText text={text} streaming={streaming} />
      </div>
    </article>
  );
});
