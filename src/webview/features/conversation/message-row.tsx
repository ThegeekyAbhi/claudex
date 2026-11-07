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
export const MessageRow = memo(function MessageRow({
  message,
  streaming,
  guides,
}: {
  message: Message;
  streaming?: boolean;
  guides: Guides;
}) {
  const { role, text } = message;
  if (role === 'notice')
    return (
      <output className="block text-[12px] bg-surface wrap-anywhere border border-subtle rounded-md my-2.5 px-3 py-2 text-muted-foreground">
        {text}
      </output>
    );
  if (role === 'image' && message.image) return <ImageMessage image={message.image} />;
  if (role === 'user')
    return (
      <article className="my-3.5 [&.user]:bg-raised [&.user]:border [&.user]:border-subtle [&.user]:rounded-[8px] [&.user]:px-3 [&.user]:py-2 [&.user]:mt-6 [&.user]:first:mt-0 in-[.subagent-transcript]:my-2 in-[.subagent-transcript]:text-[12px] user">
        {message.attachments?.length ? (
          <div className="flex flex-wrap items-start gap-1 pt-2 px-2.5 pb-0 in-[.user]:pt-0 in-[.user]:px-0 in-[.user]:pb-1.5">
            {message.attachments.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a sent message's attachments never change
              <AttachmentChip key={index} attachment={item} />
            ))}
          </div>
        ) : null}
        <div className="markdown">
          <MarkdownText text={text} />
        </div>
        <GuideDisclosures message={message} guides={guides} />
      </article>
    );
  return (
    <article className="my-3.5 [&.user]:bg-raised [&.user]:border [&.user]:border-subtle [&.user]:rounded-[8px] [&.user]:px-3 [&.user]:py-2 [&.user]:mt-6 [&.user]:first:mt-0 in-[.subagent-transcript]:my-2 in-[.subagent-transcript]:text-[12px] assistant">
      <div className="markdown">
        <MarkdownText text={text} streaming={streaming} />
      </div>
    </article>
  );
});
