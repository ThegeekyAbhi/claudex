import { useEffect, useRef, useState } from 'react';
import { mergeSnapshot, type Snapshot, setProfiles } from '../../shared/model';
import type { ContextResults } from '../features/attachments/context-menu';
import { emptySnapshot, type HostMessage, send } from './bridge';
import { type HostMessageTargets, receiveHostMessage } from './host-messages';

export function useHostMessages(handlers: Omit<HostMessageTargets, 'snapshot'>) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [imageBase, setImageBase] = useState('');
  const [contextResults, setContextResults] = useState<ContextResults>();
  const currentTargets: HostMessageTargets = {
    ...handlers,
    snapshot: {
      update: (update, tail) => {
        setSnapshot((current) => {
          const merged = mergeSnapshot(current, update, tail);
          // A tail with nothing to attach it to: ask for everything again.
          if (!merged) send({ type: 'ready' });
          // Labels, mentions and the agent rail all read the shared profile list.
          if (merged?.agents) setProfiles(merged.agents.profiles);
          return merged ?? current;
        });
      },
      imageBase: setImageBase,
      context: setContextResults,
    },
  };
  const targets = useRef(currentTargets);
  targets.current = currentTargets;
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) =>
      receiveHostMessage(event.data, targets.current);
    window.addEventListener('message', listener);
    send({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);
  return { snapshot, imageBase, contextResults };
}
