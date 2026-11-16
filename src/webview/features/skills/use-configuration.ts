import { useEffect, useState } from 'react';
import type { ConfigurationInspection, ConfigurationResult } from '../../../shared/model';
import { type HostMessage, send } from '../../app/bridge';

interface InspectionState {
  context: string;
  status: 'loading' | 'ready' | 'error';
  inspection?: ConfigurationInspection;
  error?: string;
}

export function useConfiguration(agent: string, cwd: string | undefined, identity: string) {
  const context = JSON.stringify([agent, cwd, identity]);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<InspectionState>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh repeats the same contextual read
  useEffect(() => {
    if (!cwd) return;
    const requestId = crypto.randomUUID();
    const receive = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (
        message.type !== 'configurationResult' ||
        message.requestId !== requestId ||
        message.agent !== agent
      )
        return;
      const result: ConfigurationResult = message;
      if (result.inspection?.cwd !== cwd && !result.error) return;
      setState((previous) => ({
        context,
        status: result.inspection ? 'ready' : 'error',
        inspection:
          result.inspection ?? (previous?.context === context ? previous.inspection : undefined),
        error: result.error,
      }));
    };
    window.addEventListener('message', receive);
    setState((previous) => ({
      context,
      status: 'loading',
      inspection: previous?.context === context ? previous.inspection : undefined,
    }));
    send({ type: 'inspectConfiguration', agent, requestId });
    const timeout = setTimeout(
      () =>
        setState((previous) =>
          previous?.context === context && previous.status === 'loading'
            ? {
                ...previous,
                status: 'error',
                error: 'Configuration inspection timed out. Refresh to try again.',
              }
            : previous,
        ),
      15_000,
    );
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(timeout);
    };
  }, [agent, cwd, context, refresh]);
  return {
    state: state?.context === context ? state : undefined,
    refresh: () => setRefresh((value) => value + 1),
  };
}
