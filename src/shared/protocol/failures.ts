import type { Action } from './actions';

export type ActionFailure =
  | { kind: 'submission'; submissionId: string; draftKey: string }
  | { kind: 'changes'; requestId: string; id: string };

/** Only schema-validated actions may supply failure routing identities. */
export function actionFailure(action: Action): ActionFailure | undefined {
  switch (action.type) {
    case 'start':
    case 'delegate':
      return action.submissionId
        ? { kind: 'submission', submissionId: action.submissionId, draftKey: action.draftKey }
        : undefined;
    case 'send':
    case 'rewind':
      return action.submissionId
        ? { kind: 'submission', submissionId: action.submissionId, draftKey: action.id }
        : undefined;
    case 'changes':
      return action.requestId
        ? { kind: 'changes', requestId: action.requestId, id: action.id }
        : undefined;
    default:
      return undefined;
  }
}
