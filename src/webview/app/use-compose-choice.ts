import { useEffect, useState } from 'react';
import {
  type AgentKind,
  type AgentMode,
  type AgentSetup,
  canRun,
  profileProvider,
} from '../../shared/model';
import type { ComposeChoice, ViewState } from './bridge';

export function useComposeChoice(saved: ViewState | undefined, agents: AgentSetup | undefined) {
  const [choice, setChoice] = useState<ComposeChoice>(saved?.compose ?? { agent: 'codex' });
  const [dismissedNudges, setDismissedNudges] = useState<string[]>(saved?.dismissedNudges ?? []);
  // A new chat starts on an agent you have: if the saved one isn't installed or was removed,
  // the first that can run takes its place, preferring another profile of the same CLI.
  useEffect(() => {
    if (!agents?.profiles.some((profile) => profile.status)) return;
    const current = agents.profiles.find((profile) => profile.id === choice.agent);
    if (current && canRun(current)) return;
    const ready = agents.profiles.filter(canRun);
    const next =
      ready.find((profile) => profile.provider === profileProvider(choice.agent)) ?? ready[0];
    if (next) setChoice((value) => ({ agent: next.id, modes: value.modes }));
  }, [agents, choice.agent]);
  function rememberMode(agent: AgentKind, mode: AgentMode) {
    setChoice((current) => ({ ...current, modes: { ...current.modes, [agent]: mode } }));
  }
  return { choice, setChoice, dismissedNudges, setDismissedNudges, rememberMode };
}
