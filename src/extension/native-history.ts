import { randomUUID } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../application/sessions/session-manager';
import { mergeNative, type SyncOutcome, syncCursor } from '../application/sessions/session-sync';
import { markBefore, readAppended, type TailMark } from '../providers/history/claude-tail';
import {
  claudeTranscript,
  codexTranscript,
  type NativeTranscript,
} from '../providers/history/transcript';
import { TranscriptClock } from '../providers/history/transcript-files';
import {
  listClaudeSessions,
  listCodexThreads,
  type NativeSessionInfo,
  readClaudeRecords,
  readCodexTurns,
} from '../providers/terminal';
import {
  type AgentProfile,
  agentKind,
  findProfile,
  type NativeSessionEntry,
  runnableProfiles,
  type Session,
} from '../shared/model';
import { launcherFor, legacyHistoryDir } from './launcher';

const LIST_LIMIT = 40;
/** When a transcript's file time can't be read, how often it may be read anyway. */
const RECHECK_MS = 15_000;
/**
 * How long a watched transcript must be quiet before it's read. The CLI writes a turn as many
 * lines in quick succession; reading once they settle shows them together.
 */
const SETTLE_MS = { claude: 250, codex: 1_000 } as const;
/** Listing starts a process per account, so switching windows back and forth reuses the last. */
const RELIST_MS = 60_000;
/** How long a send waits for the terminal's newest turns before going ahead without them. */
const CATCH_UP_MS = 5_000;

export interface NativeHistoryContext {
  sessions: Pick<Sessions, 'sessions' | 'get' | 'create' | 'changed'>;
  output: Pick<vscode.OutputChannel, 'appendLine'>;
  extension: Pick<vscode.ExtensionContext, 'extensionPath'>;
  publish(full?: boolean): Promise<void>;
}

/**
 * Keeps threads here and the CLIs' own sessions in step, both ways. A turn sent here is written
 * to the CLI's session, so `--resume` in a terminal shows it. A turn run in a terminal is read
 * back from the CLI's transcript. Nothing here writes to a CLI's files.
 */
export class NativeHistory {
  private found: NativeSessionEntry[] = [];
  private inFlight = new Map<string, Promise<SyncOutcome | undefined>>();
  private checkedAt = new Map<string, number>();
  private listing?: Promise<void>;
  private listedAt = 0;
  private clock = new TranscriptClock();
  /** The transcript's file time when it was last read, per thread. */
  private readAt = new Map<string, number>();
  /** Where each Claude transcript was last read to, so the next read takes only what's new. */
  private tails = new Map<string, TailMark>();
  private watcher?: { id: string; close(): void };
  /** Bumped on every `follow`, so only the latest thread opened ends up followed. */
  private following = 0;
  /** The thread that should be followed, even before its transcript exists. */
  private wanted?: string;
  constructor(private context: NativeHistoryContext) {}

  /** Found sessions no thread here is linked to yet, newest first. */
  entries(): NativeSessionEntry[] {
    const linked = new Set(
      this.context.sessions.sessions.map((session) => session.nativeId).filter(Boolean),
    );
    return this.found.filter((entry) => !linked.has(entry.sessionId));
  }
  private sdkPath(): string {
    return path.join(
      this.context.extension.extensionPath,
      'dist/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    );
  }
  private claudeEnv(profileId?: string): Record<string, string> {
    const launcher = launcherFor('claude', profileId);
    const profile = findProfile(profileId ?? 'claude');
    // A claud2 wrapper sets its folder itself, so the old setting is the only other place to look.
    const legacy = profile && legacyHistoryDir(profile);
    return launcher.env ?? (legacy ? { CLAUDE_CONFIG_DIR: legacy } : {});
  }
  private env(
    session: Pick<Session, 'provider' | 'profileId'>,
  ): Record<string, string> | undefined {
    return session.provider === 'codex'
      ? launcherFor('codex', session.profileId).env
      : this.claudeEnv(session.profileId);
  }
  /**
   * What the CLI recorded for this thread, as rows. For Claude, only the lines added since the
   * last read are read, straight from the transcript and with no process; the first read, and
   * any time those lines can't be trusted alone, goes through Claude Code's own reader. `mark` is
   * where this read stopped; the caller keeps it only once the rows are in the thread.
   */
  async read(session: Session): Promise<NativeTranscript & { mark?: TailMark }> {
    const nativeId = session.nativeId;
    if (!nativeId) return { messages: [], skipped: 0 };
    if (session.provider === 'codex') {
      const { executable, env } = launcherFor('codex', session.profileId);
      const since = Math.max(0, syncCursor(session) - 60_000);
      return codexTranscript(
        session,
        await readCodexTurns(executable, nativeId, session.cwd, since, env),
      );
    }
    const env = this.claudeEnv(session.profileId);
    const file = await this.clock.file('claude', nativeId, session.cwd, env).catch(() => undefined);
    const last = this.tails.get(session.id);
    if (file && last?.file === file) {
      const appended = await readAppended(last);
      if (appended)
        return {
          ...claudeTranscript(session, appended.records, unfinishedCalls(session)),
          mark: appended.mark,
        };
    }
    // Taken before reading, so anything written meanwhile is read again next time, not missed.
    const mark = file ? await markBefore(file) : undefined;
    const records = await readClaudeRecords(this.sdkPath(), nativeId, session.cwd, env);
    return { ...claudeTranscript(session, records), ...(mark ? { mark } : {}) };
  }
  /**
   * Brings in what the CLI recorded since this thread last matched it. Skipped while a turn runs
   * here: that turn finishes first, then this reads once. Unless forced, nothing is read when the
   * transcript's file hasn't changed since the last read.
   */
  sync(
    id: string,
    options: { force?: boolean; announce?: boolean } = {},
  ): Promise<SyncOutcome | undefined> {
    const running = this.inFlight.get(id);
    // A forced read must see what was written after the one already going had started.
    if (running)
      return options.force
        ? running.catch(() => undefined).then(() => this.sync(id, options))
        : running;
    if (!vscode.workspace.isTrusted) return Promise.resolve(undefined);
    const session = this.context.sessions.sessions.find((item) => item.id === id);
    if (!session?.nativeId || session.observed) return Promise.resolve(undefined);
    if (session.status === 'running' || session.status === 'waiting')
      return Promise.resolve(undefined);
    const work = (async () => {
      try {
        const modified = await this.modifiedAt(session);
        if (!options.force) {
          if (modified !== undefined && modified <= (this.readAt.get(id) ?? -1)) return undefined;
          // With no file time to go by, read at most every so often.
          if (modified === undefined && Date.now() - (this.checkedAt.get(id) ?? 0) < RECHECK_MS)
            return undefined;
        }
        this.checkedAt.set(id, Date.now());
        const { mark, ...rows } = await this.read(session);
        // A turn may have started here while the CLI's history was being read. The rows aren't
        // used, so the next read starts from where this one did.
        if (session.status === 'running' || session.status === 'waiting') return undefined;
        const synced = session.nativeSyncedAt;
        const shown = session.messages.length;
        const outcome = mergeNative(session, rows, {
          announce: options.announce ?? session.messages.length > 0,
        });
        if (mark) this.tails.set(id, mark);
        else this.tails.delete(id);
        // A new thread's transcript only appears once it has run: follow it from then on.
        if (this.wanted === id && !this.watcher) void this.follow(id);
        if (modified !== undefined) this.readAt.set(id, modified);
        if (outcome.added || outcome.updated || session.messages.length !== shown)
          this.context.sessions.changed(true);
        // Only the read position moved: saved with the next change, and nothing to redraw.
        else if (session.nativeSyncedAt !== synced) this.context.sessions.changed();
        return outcome;
      } finally {
        this.inFlight.delete(id);
      }
    })();
    this.inFlight.set(id, work);
    return work;
  }
  private modifiedAt(session: Session): Promise<number | undefined> {
    if (!session.nativeId) return Promise.resolve(undefined);
    return this.clock
      .modifiedAt(session.provider, session.nativeId, session.cwd, this.env(session))
      .catch(() => undefined);
  }
  /**
   * Before a message is sent here, brings in any turn the terminal ran since this thread last
   * matched it. Otherwise the turn about to run would move past it and it would never show.
   * Reads only when the transcript's file changed, and gives up after a few seconds, saying so.
   */
  async catchUp(id: string): Promise<void> {
    const session = this.context.sessions.sessions.find((item) => item.id === id);
    if (!session?.nativeId || session.observed || !vscode.workspace.isTrusted) return;
    const modified = await this.modifiedAt(session);
    const seen = Math.max(syncCursor(session), this.readAt.get(id) ?? 0);
    if (modified !== undefined && modified <= seen) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), CATCH_UP_MS);
    });
    try {
      const result = await Promise.race([this.sync(id, { force: true, announce: true }), late]);
      if (result !== 'late') return;
    } catch (error) {
      this.context.output.appendLine(`History: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    session.messages.push({
      id: randomUUID(),
      role: 'notice',
      text: 'Couldn’t check the CLI’s history for turns run in a terminal before sending. Any made since the last check may not show here; the CLI still has them.',
    });
    this.context.sessions.changed(true);
  }
  /**
   * Follows the open thread's transcript, so what a terminal adds shows here as it's written,
   * with no click or refresh. Only one thread is followed at a time, and only its file is read.
   */
  async follow(id: string | undefined): Promise<void> {
    this.wanted = id;
    if (this.watcher?.id === id) return;
    const turn = ++this.following;
    this.watcher?.close();
    this.watcher = undefined;
    const session = id && this.context.sessions.sessions.find((item) => item.id === id);
    if (!session || !session.nativeId || session.observed || !vscode.workspace.isTrusted) return;
    const file = await this.clock
      .file(session.provider, session.nativeId, session.cwd, this.env(session))
      .catch(() => undefined);
    // Another thread may have been opened while this one's file was being found.
    if (!file || turn !== this.following) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watcher: FSWatcher | undefined;
    const close = () => {
      clearTimeout(timer);
      watcher?.close();
      if (this.watcher?.close === close) this.watcher = undefined;
    };
    const read = () => {
      void this.sync(session.id, { announce: true })
        .then((outcome) => {
          if (outcome && (outcome.added || outcome.updated)) void this.context.publish(true);
        })
        .catch((error) => this.context.output.appendLine(`History: ${String(error)}`));
    };
    try {
      watcher = watch(file, { persistent: false }, (event) => {
        // A replaced or moved file isn't the one being watched any more: once it settles, read
        // it and follow whatever is there now, unless another thread was opened meanwhile.
        if (event === 'rename') {
          close();
          setTimeout(() => {
            if (turn !== this.following) return;
            read();
            void this.follow(session.id);
          }, SETTLE_MS[session.provider]);
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(read, SETTLE_MS[session.provider]);
      });
      watcher.on('error', close);
    } catch (error) {
      this.context.output.appendLine(`History: couldn’t follow ${file}: ${String(error)}`);
      return;
    }
    this.watcher = { id: session.id, close };
  }
  dispose(): void {
    this.following += 1;
    this.wanted = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }
  /** Looks for each profile's sessions in this folder. A failing profile hides only its own. */
  refresh(options: { force?: boolean } = {}): Promise<void> {
    if (this.listing) return this.listing;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd || !vscode.workspace.isTrusted) return Promise.resolve();
    if (!options.force && Date.now() - this.listedAt < RELIST_MS) return Promise.resolve();
    this.listedAt = Date.now();
    this.listing = (async () => {
      const results = await Promise.all(
        runnableProfiles().map(async (profile) => {
          try {
            return (await this.list(profile, cwd)).map(
              (info): NativeSessionEntry => ({ profileId: profile.id, ...pick(info) }),
            );
          } catch (error) {
            this.context.output.appendLine(`History for ${profile.label}: ${String(error)}`);
            return [];
          }
        }),
      );
      this.found = results.flat().sort((a, b) => b.updatedAt - a.updatedAt);
      await this.context.publish(true);
    })().finally(() => {
      this.listing = undefined;
    });
    return this.listing;
  }
  private list(profile: AgentProfile, cwd: string): Promise<NativeSessionInfo[]> {
    if (profile.provider === 'codex') {
      const { executable, env } = launcherFor('codex', profile.id);
      return listCodexThreads(executable, cwd, LIST_LIMIT, env);
    }
    return listClaudeSessions(this.sdkPath(), cwd, LIST_LIMIT, this.claudeEnv(profile.id));
  }
  /**
   * Opens a CLI session as a thread here. It keeps the session's own id, so sending here continues
   * the same session the terminal resumes, and the two stay one conversation.
   */
  async open(profileId: string, sessionId: string): Promise<Session> {
    const existing = this.context.sessions.sessions.find(
      (session) => session.nativeId === sessionId && agentKind(session) === profileId,
    );
    if (existing) return existing;
    const entry = this.found.find(
      (item) => item.profileId === profileId && item.sessionId === sessionId,
    );
    if (!entry) throw new Error('That session is no longer in the CLI’s history.');
    const profile = findProfile(profileId);
    if (!profile) throw new Error('That account is no longer set up here.');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) throw new Error('Open the project folder to continue this session.');
    const session = this.context.sessions.create(
      profile.provider,
      cwd,
      cwd,
      entry.title,
      undefined,
      profileId,
    );
    session.nativeId = sessionId;
    session.origin = 'terminal';
    // Everything the CLI has is new here, even if this first read fails and the next one runs.
    session.nativeSyncedAt = 0;
    session.titleSource = 'provider';
    session.createdAt = entry.createdAt ?? entry.updatedAt;
    session.updatedAt = entry.updatedAt;
    try {
      await this.sync(session.id, { force: true, announce: false });
    } catch (error) {
      this.context.output.appendLine(String(error));
      session.messages.push({
        id: `${session.id}-unread`,
        role: 'notice',
        text: 'Couldn’t read this session’s history. The CLI still has it, and it carries on when you send.',
      });
      this.context.sessions.changed(true);
    }
    return session;
  }
}
function pick(info: NativeSessionInfo): Omit<NativeSessionEntry, 'profileId'> {
  return {
    sessionId: info.sessionId,
    title: info.title,
    updatedAt: info.updatedAt,
    ...(info.createdAt !== undefined ? { createdAt: info.createdAt } : {}),
  };
}
/** Calls this thread still shows unfinished, whose results may be among the newest lines. */
function unfinishedCalls(session: Session) {
  return session.messages
    .filter(
      (message) => message.tool?.status === 'running' || message.tool?.status === 'interrupted',
    )
    .slice(-200);
}
