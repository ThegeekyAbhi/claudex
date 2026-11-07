import path from 'node:path';
import * as vscode from 'vscode';
import type { Sessions } from '../application/sessions/session-manager';
import { mergeNative, type SyncOutcome, syncCursor } from '../application/sessions/session-sync';
import {
  claudeTranscript,
  codexTranscript,
  type NativeTranscript,
} from '../providers/history/transcript';
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
/** Re-reading a transcript on every click would start a process each time. */
const RECHECK_MS = 15_000;

export interface NativeHistoryContext {
  sessions: Pick<Sessions, 'sessions' | 'get' | 'create' | 'changed'>;
  terminals: Map<string, unknown>;
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
  /** The CLI's whole transcript for this thread, as rows. */
  async read(session: Session): Promise<NativeTranscript> {
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
    return claudeTranscript(
      session,
      await readClaudeRecords(
        this.sdkPath(),
        nativeId,
        session.cwd,
        this.claudeEnv(session.profileId),
      ),
    );
  }
  /**
   * Brings in what the CLI recorded since this thread last matched it. Skipped while a turn runs
   * here or the thread is open in a terminal: those finish first, then this reads once.
   */
  sync(
    id: string,
    options: { force?: boolean; announce?: boolean } = {},
  ): Promise<SyncOutcome | undefined> {
    const running = this.inFlight.get(id);
    if (running) return running;
    const session = this.context.sessions.sessions.find((item) => item.id === id);
    if (!session?.nativeId || session.observed) return Promise.resolve(undefined);
    if (session.status === 'running' || session.status === 'waiting')
      return Promise.resolve(undefined);
    if (this.context.terminals.has(id)) return Promise.resolve(undefined);
    const last = this.checkedAt.get(id) ?? 0;
    if (!options.force && Date.now() - last < RECHECK_MS) return Promise.resolve(undefined);
    this.checkedAt.set(id, Date.now());
    const work = (async () => {
      try {
        const rows = await this.read(session);
        // A turn may have started here while the CLI's history was being read.
        if (session.status === 'running' || session.status === 'waiting') return undefined;
        const outcome = mergeNative(session, rows, {
          announce: options.announce ?? session.messages.length > 0,
        });
        this.context.sessions.changed(true);
        return outcome;
      } finally {
        this.inFlight.delete(id);
      }
    })();
    this.inFlight.set(id, work);
    return work;
  }
  /** Looks for each profile's sessions in this folder. A failing profile hides only its own. */
  refresh(): Promise<void> {
    if (this.listing) return this.listing;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd || !vscode.workspace.isTrusted) return Promise.resolve();
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
    session.titleSource = 'provider';
    session.createdAt = entry.updatedAt;
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
  return { sessionId: info.sessionId, title: info.title, updatedAt: info.updatedAt };
}
