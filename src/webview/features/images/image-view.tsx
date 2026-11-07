import { createContext, useContext, useState } from 'react';
import type { MessageImage } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';

/** Where this webview may load stored images from. The host supplies it. */
export const ImageBase = createContext('');
export function useImageUrl(file?: string): string | undefined {
  const base = useContext(ImageBase);
  return file && base ? `${base}/${file}` : undefined;
}
export function ImagePreview({
  url,
  alt,
  className,
}: {
  url?: string;
  alt: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const [actualSize, setActualSize] = useState(false);
  const [dimensions, setDimensions] = useState<{ url: string; label: string }>();
  const failed = Boolean(url && failedUrl === url);
  return (
    <Dialog onOpenChange={() => setActualSize(false)}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`image-preview group relative cursor-zoom-in ${className ?? ''}`}
          aria-label={`View image full size: ${alt}`}
          disabled={!url || failed}
        >
          {url && !failed ? (
            <>
              <img
                src={url}
                alt={alt}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setDimensions({ url, label: `${image.naturalWidth} × ${image.naturalHeight}` });
                }}
                onError={() => setFailedUrl(url)}
              />
              <span
                className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md bg-surface border border-subtle px-2 py-1 text-[11px] text-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              >
                <Icon name="search" size={13} />
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">Image unavailable</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        className="lightbox top-4 bottom-4 left-4 right-4 translate-x-0 translate-y-0 w-auto max-w-none sm:max-w-none min-w-0 grid-rows-[auto_minmax(0,1fr)] p-0 bg-surface border-subtle gap-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-3 py-2">
          <div className="flex-1 min-w-0">
            <DialogTitle className="truncate text-[12px] font-medium" title={alt}>
              Image viewer: {alt}
            </DialogTitle>
            {dimensions && dimensions.url === url ? (
              <span className="text-[11px] text-muted-foreground">{dimensions.label}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-pressed={!actualSize}
              onClick={() => setActualSize(false)}
              className="text-[11px] px-2 py-1 aria-pressed:bg-accent"
            >
              Fit
            </button>
            <button
              type="button"
              aria-pressed={actualSize}
              onClick={() => setActualSize(true)}
              className="text-[11px] px-2 py-1 aria-pressed:bg-accent"
            >
              Actual size
            </button>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close image"
                className="p-2 text-muted-foreground enabled:hover:text-foreground"
              >
                <Icon name="close" size={16} />
              </button>
            </DialogClose>
          </div>
        </div>
        <section
          className="min-h-0 min-w-0 overflow-auto bg-background p-3"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard scrolling
          tabIndex={0}
          aria-label="Image preview"
        >
          {failed ? (
            <output>This image is no longer available.</output>
          ) : (
            <img
              src={url}
              alt={alt}
              className={
                actualSize ? 'block max-w-none m-auto' : 'block w-full h-full object-contain'
              }
              onError={() => setFailedUrl(url)}
            />
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
const imageCard =
  'image-card mx-0 my-3.5 border border-subtle rounded-lg bg-raised overflow-hidden text-[12px]';
export function ImageMessage({ image }: { image: MessageImage }) {
  const url = useImageUrl(image.file);
  const viewedPath = image.prompt?.startsWith('Viewed ') ? image.prompt.slice(7) : undefined;
  const alt = viewedPath?.split(/[/\\]/).pop() || image.prompt || 'Generated image';
  if (image.status === 'generating')
    return (
      <output className={`${imageCard} block`}>
        <div className="flex flex-col items-center justify-center gap-2 h-[180px] text-muted-foreground bg-surface">
          <Icon name="image" size={18} />
          <span className="shimmer">Generating image…</span>
        </div>
        {image.prompt ? (
          <p className="m-0 px-3 py-2 text-muted-foreground">{image.prompt}</p>
        ) : null}
      </output>
    );
  if (image.status === 'failed' || !url)
    return (
      <div className={`${imageCard} px-3 py-2 text-error`} role="alert">
        <span className="flex items-center gap-1.5">
          <Icon name="x" size={13} /> {image.failure ?? 'This image is no longer available.'}
        </span>
        {image.prompt ? <p className="m-0 pt-1 text-muted-foreground">{image.prompt}</p> : null}
      </div>
    );
  const { file } = image;
  return (
    <figure className={imageCard}>
      <ImagePreview
        url={url}
        alt={alt}
        className="flex items-center justify-center w-full min-h-24 p-3 border-0 rounded-none bg-background enabled:hover:bg-background [&_img]:block [&_img]:max-w-full [&_img]:max-h-[min(280px,40vh)] [&_img]:object-contain"
      />
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-subtle px-3 py-2 text-muted-foreground">
        <span className="flex-1 min-w-0 truncate" title={viewedPath ?? image.prompt}>
          {alt}
        </span>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            className="px-1.5 py-1 text-[11px] text-muted-foreground enabled:hover:text-foreground"
            onClick={() => file && send({ type: 'openImage', file })}
          >
            Open
          </button>
          <button
            type="button"
            className="px-1.5 py-1 text-[11px] text-muted-foreground enabled:hover:text-foreground"
            onClick={() => file && send({ type: 'openImage', file, reveal: true })}
          >
            Reveal
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
