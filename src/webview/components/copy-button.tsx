import { useEffect, useRef, useState } from 'react';
import { requestCopy } from '../app/bridge';
import { Icon } from './icons';

export function CopyButton({
  text,
  kind = 'response',
  disabled = false,
}: {
  text: string;
  kind?: 'response' | 'message' | 'code';
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<(() => void) | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboard = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );
  const label = kind === 'code' ? 'Copy code' : `Copy full ${kind}`;
  const iconSize = kind === 'code' ? 12 : 16;
  return (
    <>
      <button
        type="button"
        aria-label={copied ? `Copied ${kind}` : label}
        title={copied ? 'Copied' : label}
        disabled={disabled}
        className={kind === 'code' ? 'response-copy code-copy' : 'response-copy'}
        data-copied={copied}
        data-keyboard={keyboard.current}
        onClick={(event) => {
          keyboard.current = event.detail === 0;
          pending.current?.();
          clearTimeout(timer.current);
          setCopied(false);
          setError('');
          pending.current = requestCopy(text, (message) => {
            pending.current = undefined;
            clearTimeout(timer.current);
            setCopied(message.ok);
            setError(message.ok ? '' : `Could not copy ${kind}. Try again.`);
            if (message.ok) timer.current = setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <span className="copy-glyph" aria-hidden="true">
          <Icon name="copy" size={iconSize} />
        </span>
        <span className="check-glyph" aria-hidden="true">
          <Icon name="check" size={iconSize} />
        </span>
      </button>
      <output className="sr-only">{error || (copied ? `Copied ${kind}` : '')}</output>
    </>
  );
}
