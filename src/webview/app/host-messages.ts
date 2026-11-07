import type { Attachment, ChangesResult, SnapshotUpdate, TailMark } from '../../shared/model';
import type { HostMessage } from './bridge';

export interface HostMessageTargets {
  snapshot: {
    update: (snapshot: SnapshotUpdate, tail?: TailMark) => void;
    imageBase: (value: string) => void;
    context: (message: Extract<HostMessage, { type: 'contextResults' }>) => void;
  };
  drafts: {
    sent: (id: string, text: string) => void;
    write: (id: string, text: string) => void;
    attach: (key: string, attachment: Attachment) => void;
  };
  turns: { snapshot: () => void; sent: () => void; failed: () => void };
  tabs: { snapshot: (selectedId: string | undefined) => void };
  changes: { received: (id: string, result: ChangesResult) => void; failed: () => void };
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
    targets.drafts.sent(message.id, message.text);
    targets.turns.sent();
  }
  if (message.type === 'error') {
    targets.reportError(message.text);
    targets.turns.failed();
    targets.changes.failed();
  }
  if (message.type === 'draft') targets.drafts.write(message.id, message.text);
  if (message.type === 'attached') targets.drafts.attach(message.draftKey, message.attachment);
  if (message.type === 'contextResults') targets.snapshot.context(message);
  if (message.type === 'changes') targets.changes.received(message.id, message.result);
}
