import type { Provider } from './agents';

export type ConfigurationScope = 'system' | 'user' | 'project' | 'projectLocal' | 'managed';
export interface ConfigurationSource {
  id: string;
  path: string;
  scope: ConfigurationScope;
  status: 'read' | 'missing' | 'unavailable' | 'unsupported' | 'partial';
  managed: boolean;
}
export interface ConfigurationDeclaration {
  sourceId: string;
  key: string;
  value: string;
  category: 'setting' | 'skill' | 'credentialReference' | 'policy';
  resolution: 'localWinner' | 'overridden' | 'declarationOnly' | 'constraint';
}
export interface ConfigurationInspection {
  provider: Provider;
  cwd: string;
  host?: string;
  nativeVersion?: string;
  observedAt: string;
  sources: ConfigurationSource[];
  declarations: ConfigurationDeclaration[];
  limitations: string[];
}
export interface ConfigurationResult {
  type: 'configurationResult';
  requestId: string;
  agent: string;
  inspection?: ConfigurationInspection;
  error?: string;
}
