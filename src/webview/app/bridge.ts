import type {
  Action,
  AgentKind,
  AgentMode,
  Attachment,
  Catalog,
  ChangesResult,
  Snapshot,
  SnapshotUpdate,
  TailMark,
  Thinking,
} from '../../core/model';

export const COMPOSE_DRAFT = '__compose';
export interface ComposeChoice {
  agent: AgentKind;
  model?: string;
  effort?: string;
  thinking?: Thinking;
  worktree?: boolean;
  parentId?: string;
  /** Your last explicit mode per agent, for new threads. */
  modes?: Partial<Record<AgentKind, AgentMode>>;
}
interface ViewState {
  selectedId?: string;
  drafts: Record<string, string>;
  attachments?: Record<string, Attachment[]>;
  scroll: Record<string, number>;
  compose?: ComposeChoice;
  /** Nudges you've closed, so they stay closed. */
  dismissedNudges?: string[];
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
  | {
      type: 'snapshot';
      snapshot: SnapshotUpdate;
      selectedId?: string;
      imageBase?: string;
      tail?: TailMark;
    }
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
