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
import { DEFAULT_PREFERENCES } from '../../core/preferences';
import type { SeenAt } from '../features/threads/tab-state';
import type { ThreadViewState } from '../features/threads/thread-filter';

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
  threadView?: ThreadViewState;
  /** Open thread tabs, for this window. */
  tabs?: string[];
  /** The unsent chat showing when no thread is open. */
  activeDraft?: string;
  /** When you last saw each thread, to tell what finished while you were elsewhere. */
  seen?: SeenAt;
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
  preferences: DEFAULT_PREFERENCES,
};
