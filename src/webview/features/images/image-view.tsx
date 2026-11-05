import { createContext, useContext, useEffect, useState } from 'react';
import type { MessageImage } from '../../../core/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';

/** Where this webview may load stored images from. The host supplies it. */
export const ImageBase = createContext('');
export function useImageUrl(file?: string): string | undefined {
  const base = useContext(ImageBase);
  return file && base ? `${base}/${file}` : undefined;
}
function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <dialog
      className="lightbox fixed inset-0 z-60 size-full max-w-none max-h-none m-0 p-4 border-0 flex items-center justify-center bg-black/78 [&_img]:relative [&_img]:max-w-full [&_img]:max-h-full [&_img]:rounded-md [&_img]:pointer-events-none"
      open
      aria-label="Image viewer"
    >
      <button
        type="button"
        className="absolute inset-0 rounded-none enabled:hover:bg-transparent"
        aria-label="Close image"
        onClick={onClose}
      />
      <img src={url} alt={alt} />
    </dialog>
  );
}
export function ImageMessage({ image }: { image: MessageImage }) {
  const url = useImageUrl(image.file);
  const [open, setOpen] = useState(false);
  const alt = image.prompt ?? 'Generated image';
  if (image.status === 'generating')
    return (
      <output className="image-card mx-0 my-3.5 p-0 border border-subtle rounded-lg bg-raised overflow-hidden block text-[12px] [&_p]:m-0 [&_p]:px-2.5 [&_p]:py-1.5 [&_p]:text-muted-foreground [&.failed]:px-2.5 [&.failed]:py-2 [&.failed]:border-[color-mix(in_srgb,var(--error)_40%,transparent)] [&.failed]:text-error [&.failed_p]:pt-1 [&.failed_p]:px-0 [&.failed_p]:pb-0 [&_figcaption]:flex [&_figcaption]:items-center [&_figcaption]:justify-between [&_figcaption]:gap-2.5 [&_figcaption]:py-[5px] [&_figcaption]:pr-1.5 [&_figcaption]:pl-2.5 [&_figcaption]:text-muted-foreground [&_figcaption>span]:min-w-0 [&_figcaption>span]:truncate generating">
        <div className="flex flex-col items-center justify-center gap-2 h-[180px] text-muted-foreground bg-surface">
          <Icon name="image" size={18} />
          <span className="shimmer">Generating image…</span>
        </div>
        {image.prompt ? <p>{image.prompt}</p> : null}
      </output>
    );
  if (image.status === 'failed' || !url)
    return (
      <div
        className="image-card mx-0 my-3.5 p-0 border border-subtle rounded-lg bg-raised overflow-hidden block text-[12px] [&_p]:m-0 [&_p]:px-2.5 [&_p]:py-1.5 [&_p]:text-muted-foreground [&.failed]:px-2.5 [&.failed]:py-2 [&.failed]:border-[color-mix(in_srgb,var(--error)_40%,transparent)] [&.failed]:text-error [&.failed_p]:pt-1 [&.failed_p]:px-0 [&.failed_p]:pb-0 [&_figcaption]:flex [&_figcaption]:items-center [&_figcaption]:justify-between [&_figcaption]:gap-2.5 [&_figcaption]:py-[5px] [&_figcaption]:pr-1.5 [&_figcaption]:pl-2.5 [&_figcaption]:text-muted-foreground [&_figcaption>span]:min-w-0 [&_figcaption>span]:truncate failed"
        role="alert"
      >
        <span>
          <Icon name="x" size={13} /> {image.failure ?? 'This image is no longer available.'}
        </span>
        {image.prompt ? <p>{image.prompt}</p> : null}
      </div>
    );
  const { file } = image;
  return (
    <figure className="image-card mx-0 my-3.5 p-0 border border-subtle rounded-lg bg-raised overflow-hidden block text-[12px] [&_p]:m-0 [&_p]:px-2.5 [&_p]:py-1.5 [&_p]:text-muted-foreground [&.failed]:px-2.5 [&.failed]:py-2 [&.failed]:border-[color-mix(in_srgb,var(--error)_40%,transparent)] [&.failed]:text-error [&.failed_p]:pt-1 [&.failed_p]:px-0 [&.failed_p]:pb-0 [&_figcaption]:flex [&_figcaption]:items-center [&_figcaption]:justify-between [&_figcaption]:gap-2.5 [&_figcaption]:py-[5px] [&_figcaption]:pr-1.5 [&_figcaption]:pl-2.5 [&_figcaption]:text-muted-foreground [&_figcaption>span]:min-w-0 [&_figcaption>span]:truncate">
      <button
        type="button"
        className="block w-full p-0 rounded-none bg-surface [&_img]:block [&_img]:max-w-full [&_img]:max-h-[420px] [&_img]:m-auto"
        aria-label="View image full size"
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={alt} />
      </button>
      <figcaption>
        {image.prompt ? <span title={image.prompt}>{image.prompt}</span> : <span />}
        <div className="flex gap-0.5 shrink-0">
          <button
            type="button"
            className="px-1.5 py-0.5 text-[11px] text-muted-foreground shrink-0 enabled:hover:text-foreground in-[.changes-summary]:ml-auto"
            onClick={() => file && send({ type: 'openImage', file })}
          >
            Open
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-[11px] text-muted-foreground shrink-0 enabled:hover:text-foreground in-[.changes-summary]:ml-auto"
            onClick={() => file && send({ type: 'openImage', file, reveal: true })}
          >
            Reveal
          </button>
        </div>
      </figcaption>
      {open ? <Lightbox url={url} alt={alt} onClose={() => setOpen(false)} /> : null}
    </figure>
  );
}
