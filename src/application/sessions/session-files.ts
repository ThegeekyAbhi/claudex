import { randomUUID } from 'node:crypto';
import type { FileObserver } from '../../infrastructure/file-observer';
import type { FileDiff, Session, ToolInfo } from '../../shared/model';

interface Dependencies {
  isDisposed(): boolean;
  changed(full?: boolean): void;
}
type Observer = Pick<FileObserver, 'checkpoint' | 'flush' | 'release'>;
interface Observation {
  observer: Observer;
  start: number;
  finished: Set<string>;
  nativeSeen: Set<string>;
  closed?: boolean;
  note?: string;
}

export class SessionFiles {
  private observers = new Map<string, Observation>();
  constructor(private deps: Dependencies) {}
  observe(id: string, observer: Observer, start: number): void {
    this.observers.set(id, {
      observer,
      start,
      finished: new Set(),
      nativeSeen: new Set(),
    });
  }
  flush(id: string): Promise<void> | undefined {
    return this.observers.get(id)?.observer.flush();
  }
  flushAll(): Promise<unknown[]> {
    return Promise.all([...this.observers.values()].map(({ observer }) => observer.flush()));
  }
  forget(id: string): void {
    this.observers.delete(id);
  }
  forgetAll(): void {
    this.observers.clear();
  }
  release(id: string): void {
    const state = this.observers.get(id);
    if (state && !state.closed) this.releaseObservation(state);
  }
  private releaseObservation(state: Observation): void {
    state.closed = true;
    state.nativeSeen.clear();
    state.observer.release();
  }
  captureAfterTool(session: Session, id: string | undefined, tool: ToolInfo | undefined): void {
    const observer = this.observers.get(session.id);
    if (
      id &&
      tool &&
      tool.status !== 'running' &&
      tool.status !== 'declined' &&
      (tool.kind === 'command' || tool.kind === 'edit') &&
      !observer?.finished.has(id)
    ) {
      observer?.finished.add(id);
      this.captureFiles(session, id);
    }
  }
  captureFiles(session: Session, after?: string, final = false): void {
    const state = this.observers.get(session.id);
    if (!state || state.closed) return;
    const native: FileDiff[] = [];
    for (const message of session.messages.slice(state.start)) {
      const tool = message.tool;
      if (!tool || tool.diffSource || tool.status !== 'completed' || !tool.diffs?.length) continue;
      const key = `${message.id}:${JSON.stringify(tool.diffs)}`;
      if (state.nativeSeen.has(key)) continue;
      state.nativeSeen.add(key);
      native.push(...tool.diffs);
    }
    state.observer.checkpoint(({ diffs, note }) => {
      if (this.deps.isDisposed() || this.observers.get(session.id) !== state) return;
      const relevant = after || state.finished.size || diffs.length;
      const freshNote = relevant && note !== state.note ? note : undefined;
      state.note = note;
      if (!diffs.length && !freshNote) return;
      const message: Session['messages'][number] = {
        id: randomUUID(),
        role: 'tool',
        text: '',
        tool: {
          kind: 'other',
          name: 'filesystemChanges',
          title: 'Observed file changes',
          status: 'completed',
          diffSource: 'filesystem',
          diffs,
          captureNote: freshNote,
        },
      };
      const index = after ? session.messages.findIndex((item) => item.id === after) : -1;
      if (index >= 0) session.messages.splice(index + 1, 0, message);
      else {
        const nextUser = session.messages.findIndex(
          (item, index) => index >= state.start && item.role === 'user',
        );
        if (nextUser >= 0) session.messages.splice(nextUser, 0, message);
        else session.messages.push(message);
      }
      this.deps.changed(true);
    }, native);
    if (final) {
      this.releaseObservation(state);
    }
  }
}
