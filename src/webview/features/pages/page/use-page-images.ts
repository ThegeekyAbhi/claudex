import { useCallback, useRef } from 'react';
import {
  PAGE_IMAGE_BYTES,
  PAGE_IMAGE_TYPES,
  type PageHostMessage,
} from '../../../../shared/protocol/pages';
import { post } from '../shared/page-bridge';
import { nextRequest, readBase64 } from '../shared/requests';

/**
 * Images in the page: uploads the host saves beside your pages, and where relative image paths
 * load from. The editor calls `upload` and `imageUrl` as it needs them.
 */
export function usePageImages(onError: (text: string) => void) {
  /** Images being saved by the host, by request. */
  const uploads = useRef(
    new Map<string, { resolve(src: string): void; reject(error: Error): void }>(),
  );
  /** Where relative image paths load from; the editor reads it as images render. */
  const base = useRef<string | undefined>(undefined);

  const upload = useCallback(async (file: File): Promise<string> => {
    if (!(PAGE_IMAGE_TYPES as readonly string[]).includes(file.type))
      throw new Error('Add a PNG, JPEG, GIF or WebP image.');
    if (file.size > PAGE_IMAGE_BYTES) throw new Error('Images can be at most 10 MB.');
    const data = await readBase64(file);
    const requestId = nextRequest();
    const saved = new Promise<string>((resolve, reject) =>
      uploads.current.set(requestId, { resolve, reject }),
    );
    post({
      type: 'pageImage',
      requestId,
      name: file.name.slice(0, 200),
      mime: file.type as (typeof PAGE_IMAGE_TYPES)[number],
      data,
    });
    return saved;
  }, []);
  const imageUrl = useCallback((src: string) => {
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || !base.current) return src;
    try {
      return new URL(src, base.current).toString();
    } catch {
      return src;
    }
  }, []);
  const receive = useCallback(
    (message: PageHostMessage) => {
      if (message.type === 'page') base.current = message.state.assetBase;
      if (message.type !== 'pageImageSaved' && message.type !== 'pageImageFailed') return;
      const pending = uploads.current.get(message.requestId);
      uploads.current.delete(message.requestId);
      if (message.type === 'pageImageSaved') pending?.resolve(message.src);
      else {
        pending?.reject(new Error(message.text));
        onError(message.text);
      }
    },
    [onError],
  );
  return { upload, imageUrl, receive };
}
