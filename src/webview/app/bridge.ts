import { DEFAULT_PREFERENCES } from '../../shared/domain/preferences';
import type {
  Action,
  AgentKind,
  AgentMode,
  Attachment,
  Catalog,
  ChangesResult,
  ConfigurationResult,
  Snapshot,
  SnapshotUpdate,
  TailMark,
  Thinking,
} from '../../shared/model';
import type { ActionFailure } from '../../shared/protocol/failures';
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
export interface ViewState {
  selectedId?: string;
  accountsActive?: boolean;
  skillsActive?: boolean;
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
  /** Pane sizes for the wide layout, keyed by which panes were open. */
  layouts?: Record<string, string>;
  /** You folded the thread list in the wide layout. */
  threadsFolded?: boolean;
  /** How you last chose to build a plan, when it wasn't Auto. */
  buildApprovals?: 'manual';
}
interface HostApi {
  postMessage(
    action:
      | Action
      | { type: 'reviewReady' | 'reviewRefresh' }
      | { type: 'reviewNative' | 'reviewPatch'; entry: string }
      | { type: 'reviewViewed'; entry: string; viewed: boolean },
  ): void;
  getState(): ViewState | undefined;
  /** Returns the state it was given, as VS Code does. */
  setState(state: ViewState): ViewState;
}
declare const acquireVsCodeApi: undefined | (() => HostApi);
export const api: HostApi | undefined =
  typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
export function send(action: Action): void {
  api?.postMessage(action);
}
export interface ProfileResult {
  type: 'profileResult';
  requestId: string;
  id?: string;
  folder?: string;
  token?: string;
  cancelled?: boolean;
  error?: string;
}
export type HostMessage =
  | ProfileResult
  | ConfigurationResult
  | { type: 'copyResult'; requestId: string; ok: boolean }
  /** A side question's answer as it streams; never part of the thread. */
  | {
      type: 'sideAnswer';
      requestId: string;
      delta?: string;
      activity?: string;
      done?: boolean;
      error?: string;
    }
  | {
      type: 'snapshot';
      snapshot: SnapshotUpdate;
      selectedId?: string;
      imageBase?: string;
      tail?: TailMark;
    }
  | { type: 'sent'; id: string; text: string; submissionId?: string; threadId?: string }
  | { type: 'error'; text: string; operation?: ActionFailure }
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
/** Before the host's first snapshot. Profiles it hasn't listed yet read as loading. */
export const emptyCatalog: Catalog = {};
export const emptySnapshot: Snapshot = {
  sessions: [],
  documents: [],
  project: 'Your workspace',
  trusted: true,
  catalog: emptyCatalog,
  preferences: DEFAULT_PREFERENCES,
};

export type CopyResult = Extract<HostMessage, { type: 'copyResult' }>;
const pendingCopies = new Map<string, (result: CopyResult) => void>();

function receiveCopyResult(event: MessageEvent<HostMessage>): void {
  const message = event.data;
  if (message?.type !== 'copyResult') return;
  const receive = pendingCopies.get(message.requestId);
  if (!receive) return;
  pendingCopies.delete(message.requestId);
  if (!pendingCopies.size) window.removeEventListener('message', receiveCopyResult);
  receive(message);
}

/** One host subscription for pending copies, independent of the number of rendered buttons. */
export function requestCopy(text: string, receive: (result: CopyResult) => void): () => void {
  const requestId = crypto.randomUUID();
  if (!pendingCopies.size) window.addEventListener('message', receiveCopyResult);
  pendingCopies.set(requestId, receive);
  send({ type: 'copy', text, requestId });
  return () => {
    pendingCopies.delete(requestId);
    if (!pendingCopies.size) window.removeEventListener('message', receiveCopyResult);
  };
}
