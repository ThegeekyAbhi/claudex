import { createContext, useContext, useState } from 'react';
import type { MessageImage } from '../../../shared/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';
/** Where this webview may load stored images from. The host supplies it. */
export const ImageBase = createContext('');
export function useImageUrl(file?: string): string | undefined {
  const base = useContext(ImageBase);
  return file && base ? `${base}/${file}` : undefined;
}
export function ImagePreview({
  file,
  url,
  alt,
  className,
}: {
  file: string;
  url?: string;
  alt: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const failed = Boolean(url && failedUrl === url);
  return (
    <button
      type="button"
      className={`image-preview group relative cursor-zoom-in ${className ?? ''}`}
      aria-label={`View image full size: ${alt}`}
      title={alt}
      disabled={!url || failed}
      onClick={() => send({ type: 'openImage', file })}
    >
      {url && !failed ? (
        <img src={url} alt={alt} onError={() => setFailedUrl(url)} />
      ) : (
        <span className="text-[11px] text-muted-foreground">Image unavailable</span>
      )}
    </button>
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
  if (image.status === 'failed' || !url || !image.file)
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
        file={file}
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
