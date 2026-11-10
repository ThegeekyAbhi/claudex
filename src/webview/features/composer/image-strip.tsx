import { useLayoutEffect, useRef } from 'react';
import type { Attachment } from '../../../shared/model';
import { AttachmentChip } from '../attachments/context-menu';

export function ImageStrip({
  images,
  onRemove,
}: {
  images: Extract<Attachment, { kind: 'image' }>[];
  onRemove: (attachment: Attachment) => void;
}) {
  const strip = useRef<HTMLElement>(null);
  const last = images.at(-1)?.file;
  useLayoutEffect(() => {
    if (last && strip.current) strip.current.scrollLeft = strip.current.scrollWidth;
  }, [last]);
  if (!images.length) return null;
  return (
    <section
      ref={strip}
      className="composer-images flex flex-nowrap gap-1.5 overflow-x-auto min-w-0 max-w-full px-2.5 pt-2 pb-2"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard scrolling
      tabIndex={0}
      aria-label="Attached images"
    >
      {images.map((image) => (
        <AttachmentChip key={image.file} attachment={image} onRemove={() => onRemove(image)} />
      ))}
    </section>
  );
}
