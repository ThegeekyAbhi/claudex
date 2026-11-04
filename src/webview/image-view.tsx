import { createContext, useContext, useEffect, useState } from 'react';
import type { MessageImage } from '../model';
import { send } from './bridge';
import { Icon } from './icons';

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
    <dialog className="lightbox" open aria-label="Image viewer">
      <button
        type="button"
        className="lightbox-backdrop"
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
      <output className="image-card generating">
        <div className="image-placeholder">
          <Icon name="image" size={18} />
          <span className="shimmer">Generating image…</span>
        </div>
        {image.prompt ? <p>{image.prompt}</p> : null}
      </output>
    );
  if (image.status === 'failed' || !url)
    return (
      <div className="image-card failed" role="alert">
        <span>
          <Icon name="x" size={13} /> {image.failure ?? 'This image is no longer available.'}
        </span>
        {image.prompt ? <p>{image.prompt}</p> : null}
      </div>
    );
  const { file } = image;
  return (
    <figure className="image-card">
      <button
        type="button"
        className="image-open"
        aria-label="View image full size"
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={alt} />
      </button>
      <figcaption>
        {image.prompt ? <span title={image.prompt}>{image.prompt}</span> : <span />}
        <div className="image-actions">
          <button
            type="button"
            className="text-action"
            onClick={() => file && send({ type: 'openImage', file })}
          >
            Open
          </button>
          <button
            type="button"
            className="text-action"
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
