import { useEffect, useRef, useState } from 'react';
import { type HostMessage, send } from '../app/bridge';
import { Icon } from './icons';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboard = useRef(false);
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type !== 'copyResult' || message.requestId !== pending.current) return;
      pending.current = undefined;
      clearTimeout(timer.current);
      setCopied(message.ok);
      setError(message.ok ? '' : 'Could not copy response. Try again.');
      if (message.ok) timer.current = setTimeout(() => setCopied(false), 1500);
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
      clearTimeout(timer.current);
      pending.current = undefined;
    };
  }, []);
  return (
    <>
      <button
        type="button"
        aria-label={copied ? 'Copied response' : 'Copy full response'}
        title={copied ? 'Copied' : 'Copy full response'}
        className="response-copy"
        data-copied={copied}
        data-keyboard={keyboard.current}
        onClick={(event) => {
          keyboard.current = event.detail === 0;
          const requestId = crypto.randomUUID();
          pending.current = requestId;
          clearTimeout(timer.current);
          setCopied(false);
          setError('');
          send({ type: 'copy', text, requestId });
        }}
      >
        <span className="copy-glyph" aria-hidden="true">
          <Icon name="copy" size={16} />
        </span>
        <span className="check-glyph" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      </button>
      <output className="sr-only">{error || (copied ? 'Response copied' : '')}</output>
    </>
  );
}
