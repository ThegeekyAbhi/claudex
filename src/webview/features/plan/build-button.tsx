import { createContext, useContext, useEffect, useState } from 'react';
import {
  type AgentKind,
  agentKind,
  type BuildChoice,
  type Catalog,
  catalogFor,
  type Session,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AutoHelp } from '../../components/menus';
import { Button } from '../../components/ui/button';
import { EffortMenu } from '../models/effort-menu';
import { ModelSelector } from '../models/model-selector';
export const BuildContext = createContext<{ catalog: Catalog; sessions: Session[] } | null>(null);
export function BuildButton({
  agent,
  disabled,
  onBuild,
}: {
  agent: AgentKind;
  disabled?: boolean;
  onBuild: (choice: BuildChoice) => void;
}) {
  const context = useContext(BuildContext);
  const [worker, setWorker] = useState(false);
  const [choice, setChoice] = useState<BuildChoice>({ agent });
  const selectedAgent = choice.agent ?? agent;
  useEffect(() => {
    if (disabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      const box = document.querySelector<HTMLTextAreaElement>('.composer textarea');
      if (box?.value.trim()) return;
      event.preventDefault();
      onBuild(worker ? { ...choice, agent: selectedAgent } : {});
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [disabled, worker, choice, selectedAgent, onBuild]);
  const recent =
    context?.sessions
      .filter(
        (item) =>
          !item.model ||
          catalogFor(context.catalog, agentKind(item)).models.some(
            (model) => model.id === item.model,
          ),
      )
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (other) => agentKind(other) === agentKind(item) && other.model === item.model,
          ) === index,
      )
      .slice(0, 4) ?? [];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Implement in
        <select
          aria-label="Implementation destination"
          value={worker ? 'worker' : 'current'}
          disabled={disabled}
          className="rounded border border-subtle bg-surface px-2 py-1 text-foreground"
          onChange={(event) => setWorker(event.target.value === 'worker')}
        >
          <option value="current">This chat</option>
          <option value="worker">Linked agent</option>
        </select>
      </label>
      {worker && context ? (
        <>
          <ModelSelector
            catalog={context.catalog}
            agent={selectedAgent}
            model={choice.model}
            onSelect={(next) => setChoice(next)}
            onRetry={() => send({ type: 'refreshModels' })}
          />
          <EffortMenu
            effort={choice.effort}
            efforts={
              catalogFor(context.catalog, selectedAgent).models.find(
                (item) => item.id === choice.model,
              )?.efforts ?? []
            }
            onEffort={(effort) => setChoice({ ...choice, effort })}
          />
          {recent.length ? (
            <select
              aria-label="Recently used models"
              className="max-w-40 bg-surface text-xs"
              value=""
              onChange={(event) => {
                const item = recent[Number(event.target.value)];
                if (item)
                  setChoice({ agent: agentKind(item), model: item.model, effort: item.effort });
              }}
            >
              <option value="" disabled>
                Recently used
              </option>
              {recent.map((item, index) => (
                <option key={item.id} value={index}>
                  {agentKind(item)} · {item.model ?? 'Default'}
                </option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}
      <AutoHelp text="The provider's Auto mode makes the code changes and reviews approvals itself. It can still stop to ask you." />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={() => onBuild(worker ? { ...choice, agent: selectedAgent } : {})}
      >
        Implement plan
      </Button>
    </div>
  );
}
