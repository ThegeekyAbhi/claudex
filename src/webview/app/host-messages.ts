import type { Attachment, ChangesResult, SnapshotUpdate, TailMark } from '../../shared/model';
import type { HostMessage } from './bridge';

export interface HostMessageTargets {
  snapshot: {
    update: (snapshot: SnapshotUpdate, tail?: TailMark) => void;
    imageBase: (value: string) => void;
    context: (message: Extract<HostMessage, { type: 'contextResults' }>) => void;
  };
  drafts: {
    sent: (id: string, text: string, submissionId?: string, threadId?: string) => void;
    write: (id: string, text: string) => void;
    attach: (key: string, attachment: Attachment) => void;
  };
  turns: {
    snapshot: () => void;
    sent: (id: string, submissionId?: string) => void;
    failed: (submissionId: string, key: string) => boolean;
  };
  tabs: { snapshot: (selectedId: string | undefined) => void };
  changes: {
    received: (id: string, result: ChangesResult) => void;
    failed: (id: string, requestId: string) => boolean;
  };
  reportError: (text: string) => void;
}

export function receiveHostMessage(message: HostMessage, targets: HostMessageTargets) {
  if (message.type === 'snapshot') {
    targets.snapshot.update(message.snapshot, message.tail);
    if (message.imageBase) targets.snapshot.imageBase(message.imageBase);
    targets.turns.snapshot();
    targets.tabs.snapshot(message.selectedId);
  }
  if (message.type === 'sent') {
    targets.drafts.sent(message.id, message.text, message.submissionId, message.threadId);
    targets.turns.sent(message.id, message.submissionId);
  }
  if (message.type === 'error') {
    const operation = message.operation;
    const accepted =
      !operation ||
      (operation.kind === 'submission'
        ? targets.turns.failed(operation.submissionId, operation.draftKey)
        : targets.changes.failed(operation.id, operation.requestId));
    if (accepted) targets.reportError(message.text);
  }
  if (message.type === 'draft') targets.drafts.write(message.id, message.text);
  if (message.type === 'attached') targets.drafts.attach(message.draftKey, message.attachment);
  if (message.type === 'contextResults') targets.snapshot.context(message);
  if (message.type === 'changes') targets.changes.received(message.id, message.result);
}
