import { type AgentKind, type Catalog, catalogFor } from '../../../shared/model';

export function modelOption(catalog: Catalog, agent: AgentKind, model?: string) {
  const models = catalogFor(catalog, agent).models;
  return model
    ? models.find((item) => item.id === model || item.resolvedModel === model)
    : models.find((item) => item.isDefault);
}
export function effortsFor(catalog: Catalog, agent: AgentKind, model?: string): string[] {
  return modelOption(catalog, agent, model)?.efforts ?? [];
}
export function keepEffort(
  catalog: Catalog,
  agent: AgentKind,
  model: string | undefined,
  effort: string | undefined,
) {
  return effort && effortsFor(catalog, agent, model).includes(effort) ? effort : undefined;
}
