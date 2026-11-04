import type {
  Action,
  AgentKind,
  AgentMode,
  Attachment,
  Catalog,
  ChangesResult,
  Snapshot,
} from '../model';

export const COMPOSE_DRAFT = '__compose';
export interface ComposeChoice {
  agent: AgentKind;
  model?: string;
  effort?: string;
  worktree?: boolean;
  parentId?: string;
  mode?: AgentMode;
}
interface ViewState {
  selectedId?: string;
  drafts: Record<string, string>;
  attachments?: Record<string, Attachment[]>;
  scroll: Record<string, number>;
  compose?: ComposeChoice;
}
interface HostApi {
  postMessage(action: Action): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
}
declare const acquireVsCodeApi: undefined | (() => HostApi);
export const api: HostApi | undefined =
  typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
export function send(action: Action): void {
  api?.postMessage(action);
}
export type HostMessage =
  | { type: 'snapshot'; snapshot: Snapshot; selectedId?: string; imageBase?: string }
  | { type: 'sent'; id: string; text: string }
  | { type: 'error'; text: string }
  | { type: 'draft'; id: string; text: string }
  | { type: 'changes'; id: string; result: ChangesResult }
  | { type: 'attached'; draftKey: string; attachment: Attachment }
  | {
      type: 'contextResults';
      requestId: number;
      matches: { kind: 'file' | 'folder'; path: string }[];
      recent: string[];
      terminals: string[];
    };
export const emptyCatalog: Catalog = {
  codex: { status: 'loading', models: [] },
  claude: { status: 'loading', models: [] },
  claud2: { status: 'loading', models: [] },
};
export const emptySnapshot: Snapshot = {
  sessions: [],
  documents: [],
  project: 'Your workspace',
  trusted: true,
  catalog: emptyCatalog,
};
