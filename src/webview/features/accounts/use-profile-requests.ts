import { useEffect, useRef, useState } from 'react';
import type { Action } from '../../../shared/model';
import { type HostMessage, type ProfileResult, send } from '../../app/bridge';

export type ProfileRequest = Extract<Action, { type: 'profileRequest' }>['request'];
export function useProfileRequests() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const waiting = useRef<{ id: string; resolve: (result?: ProfileResult) => void } | undefined>(
    undefined,
  );
  useEffect(() => {
    function receive(event: MessageEvent<HostMessage>) {
      const result = event.data;
      if (result.type !== 'profileResult' || result.requestId !== waiting.current?.id) return;
      const { resolve } = waiting.current;
      waiting.current = undefined;
      setPending(false);
      setError(result.error ?? '');
      resolve(result.error || result.cancelled ? undefined : result);
    }
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      waiting.current?.resolve();
      waiting.current = undefined;
    };
  }, []);
  function request(value: ProfileRequest): Promise<ProfileResult | undefined> {
    if (waiting.current) return Promise.resolve(undefined);
    setError('');
    setPending(true);
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      waiting.current = { id, resolve };
      send({ type: 'profileRequest', requestId: id, request: value });
    });
  }
  return { request, pending, error };
}
