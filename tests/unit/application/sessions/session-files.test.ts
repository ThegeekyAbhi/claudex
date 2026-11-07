import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionFiles } from '../../../../src/application/sessions/session-files';
import type { FileObserver, ObservedChanges } from '../../../../src/infrastructure/file-observer';
import type { Session } from '../../../../src/shared/model';

type Observer = Pick<FileObserver, 'checkpoint' | 'flush' | 'release'>;
function fixture() {
  const events: string[] = [];
  let disposed = false;
  const files = new SessionFiles({
    isDisposed: () => disposed,
    changed: (full) => events.push(`changed:${full}`),
  });
  const session: Session = {
    id: 'local',
    provider: 'codex',
    title: 'Test',
    cwd: '/project',
    workspace: '/project',
    status: 'running',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  };
  const reports: ((changes: ObservedChanges) => void)[] = [];
  const observer: Observer = {
    checkpoint: (report) => {
      events.push('checkpoint');
      reports.push(report);
    },
    flush: () => {
      events.push('flush');
      return Promise.resolve();
    },
    release: () => {
      events.push('release');
    },
  };
  files.observe(session.id, observer, 0);
  return {
    events,
    files,
    session,
    reports,
    observer,
    dispose: () => {
      disposed = true;
    },
  };
}

test('release closes capture once, retains the pending checkpoint and leaves it flushable', async () => {
  const { files, session, events, reports } = fixture();
  files.captureFiles(session, 'tool');
  files.release(session.id);
  files.release(session.id);
  files.release('missing');
  files.captureFiles(session, 'another-tool', true);
  assert.deepEqual(events, ['checkpoint', 'release']);
  reports[0]({ diffs: [], note: 'Capture was limited' });
  assert.equal(session.messages.length, 1, 'a queued final report still reaches the transcript');
  assert.equal(session.messages[0].tool?.captureNote, 'Capture was limited');
  await files.flush(session.id);
  assert.deepEqual(events, ['checkpoint', 'release', 'changed:true', 'flush']);
  assert.equal(files.flush('missing'), undefined);
});

test('final capture checkpoints before release and closes the observation before notifying release', () => {
  const { files, session, events, observer } = fixture();
  files.observe(
    session.id,
    {
      ...observer,
      release: () => {
        events.push('release');
        files.captureFiles(session, 'reentrant');
      },
    },
    0,
  );
  files.captureFiles(session, undefined, true);
  files.captureFiles(session, undefined, true);
  assert.deepEqual(events, ['checkpoint', 'release']);
});

test('final capture releases the original observation if its callback installs another', () => {
  const { files, session, events, observer } = fixture();
  files.observe(
    session.id,
    {
      ...observer,
      checkpoint: (report) => {
        events.push('checkpoint:old');
        report({ diffs: [], note: 'limited' });
        files.observe(session.id, observer, session.messages.length);
      },
      release: () => {
        events.push('release:old');
      },
    },
    0,
  );
  files.captureFiles(session, 'tool', true);
  files.captureFiles(session, 'next');
  assert.deepEqual(events, ['checkpoint:old', 'changed:true', 'release:old', 'checkpoint']);
});

test('forget removes observations without releasing them and rejects stale callbacks', async () => {
  const { files, session, events, reports } = fixture();
  files.captureFiles(session, 'tool');
  files.forget(session.id);
  reports[0]({ diffs: [], note: 'stale' });
  assert.equal(session.messages.length, 0);
  assert.equal(files.flush(session.id), undefined);
  await files.flushAll();
  assert.deepEqual(events, ['checkpoint']);
});

test('forgetAll preserves flush order and prevents reports from forgotten or disposed observations', async () => {
  const { files, session, events, reports, observer, dispose } = fixture();
  files.observe(
    'second',
    {
      ...observer,
      flush: () => {
        events.push('flush:second');
        return Promise.resolve();
      },
    },
    0,
  );
  files.captureFiles(session, 'tool');
  await files.flushAll();
  assert.deepEqual(events, ['checkpoint', 'flush', 'flush:second']);
  dispose();
  reports[0]({ diffs: [], note: 'disposed' });
  assert.equal(session.messages.length, 0);
  files.forgetAll();
  assert.equal(files.flush(session.id), undefined);
  assert.equal(files.flush('second'), undefined);
  await files.flushAll();
  assert.deepEqual(events, ['checkpoint', 'flush', 'flush:second']);
});

test('tool captures keep completion eligibility and deduplicate tool checkpoints', () => {
  const { files, session, events, reports } = fixture();
  const tool = {
    kind: 'command' as const,
    name: 'shell',
    title: 'Run',
    status: 'running' as const,
  };
  files.captureAfterTool(session, 'tool', tool);
  files.captureAfterTool(session, 'tool', { ...tool, status: 'declined' });
  files.captureAfterTool(session, 'tool', { ...tool, kind: 'read', status: 'completed' });
  files.captureAfterTool(session, undefined, { ...tool, status: 'completed' });
  assert.deepEqual(events, []);
  files.captureAfterTool(session, 'tool', { ...tool, status: 'failed' });
  files.captureAfterTool(session, 'tool', { ...tool, status: 'completed' });
  assert.deepEqual(events, ['checkpoint']);
  reports[0]({ diffs: [], note: 'limited' });
  assert.equal(session.messages[0].tool?.captureNote, 'limited');
});
