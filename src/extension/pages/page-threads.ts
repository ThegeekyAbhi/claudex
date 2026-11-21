import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';
import { type Attachment, agentKind, allProfiles, canRun, findProfile } from '../../shared/model';
import type { PageChatMessage, PageConversation, PageThread } from '../../shared/protocol/pages';
import type { Surface } from '../surfaces';
import type { PagesContext, PageTarget } from './page-context';

const THREADS = 'pages.threads';

/**
 * The threads about each page: those it was sent to, and the one its own chat shows. Starting,
 * replying and stopping go through the same paths as the Claudex chat.
 */
export class PageThreads {
  /** The thread each page's chat shows; `null` once you start a new chat there. */
  private chats = new Map<string, string | null>();
  constructor(
    private context: PagesContext,
    /** Threads changed: page editors redraw. */
    private changed: () => void,
  ) {}

  /** The page's threads, newest first. */
  list(id: string): PageThread[] {
    const known = new Map(this.context.sessions.sessions.map((session) => [session.id, session]));
    return (this.links()[id] ?? [])
      .map((threadId) => known.get(threadId))
      .filter((session) => session !== undefined)
      .map((session) => ({
        id: session.id,
        title: session.title,
        agent: agentKind(session),
        status: session.status,
        updatedAt: session.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  }
  /** A thread was sent pages: each remembers it, newest first. */
  link(threadId: string, attachments?: Attachment[]): void {
    const pages = (attachments ?? []).flatMap((item) => (item.kind === 'page' ? [item.id] : []));
    if (pages.length) void this.linkPages(threadId, pages);
  }
  async linkPages(threadId: string, pages: string[]): Promise<void> {
    const links = { ...this.links() };
    for (const id of pages)
      links[id] = [threadId, ...(links[id] ?? []).filter((other) => other !== threadId)].slice(
        0,
        20,
      );
    await this.context.state.update(THREADS, links);
    this.changed();
  }
  /** The agent a new page chat uses: the one you used last, if it can run. */
  defaultProfile(): string | undefined {
    const recent = [...this.context.sessions.sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => agentKind(session))
      .find((kind) => {
        const profile = findProfile(kind);
        return profile && canRun(profile);
      });
    return recent ?? allProfiles().find(canRun)?.id;
  }

  /**
   * Starts a thread about a page with your message, shown in the page's own chat. The Claudex
   * side bar stays as it is: the page editor stands in for it while the thread starts.
   */
  async ask(
    target: PageTarget & { title: string },
    prompt: string,
    webview: vscode.Webview,
    profile?: string,
    mode?: 'ask' | 'auto',
  ): Promise<void> {
    const agent = profile && findProfile(profile) ? profile : this.defaultProfile();
    if (!agent) throw new Error('Set up Claude Code or Codex first.');
    const key = chatKey(target);
    const attachment: Attachment = target.id
      ? { kind: 'page', id: target.id, title: target.title }
      : { kind: 'file', path: target.path ?? '' };
    await this.context.startThread(
      {
        type: 'start',
        agent,
        text: prompt,
        draftKey: `page-${randomBytes(4).toString('hex')}`,
        ...(mode ? { mode } : {}),
        attachments: [attachment],
      },
      pageSurface(webview, (threadId) => {
        this.chats.set(key, threadId);
        this.changed();
      }),
    );
  }
  /** A follow-up in the page's chat. Only a thread this page started or was sent to. */
  async reply(
    target: PageTarget,
    threadId: string,
    prompt: string,
    webview: vscode.Webview,
  ): Promise<void> {
    this.require(target, threadId);
    await this.context.send(threadId, prompt, pageSurface(webview));
  }
  async stop(target: PageTarget, threadId: string, webview: vscode.Webview): Promise<void> {
    this.require(target, threadId);
    await this.context.interrupt(threadId, pageSurface(webview));
  }
  /** Shows one of the page's threads in its chat, or none, to start a new one. */
  show(target: PageTarget, threadId?: string): void {
    if (threadId) this.require(target, threadId);
    this.chats.set(chatKey(target), threadId ?? null);
    this.changed();
  }

  /** The thread the page's chat shows, as the page draws it. */
  conversation(target: PageTarget): PageConversation | undefined {
    const key = chatKey(target);
    const chosen = this.chats.has(key)
      ? this.chats.get(key)
      : target.id
        ? this.list(target.id)[0]?.id
        : undefined;
    if (!chosen) return undefined;
    const session = this.context.sessions.sessions.find((item) => item.id === chosen);
    if (!session) return undefined;
    const messages: PageChatMessage[] = session.messages
      .flatMap((message): PageChatMessage[] => {
        if (message.role === 'user' || message.role === 'assistant')
          return message.text.trim()
            ? [{ id: message.id, role: message.role, text: message.text }]
            : [];
        if (message.role === 'image' && message.image?.status === 'ready' && message.image.file)
          return [
            {
              id: message.id,
              role: 'image',
              text: message.image.prompt ?? '',
              image: {
                file: message.image.file,
                ...(message.image.prompt ? { prompt: message.image.prompt } : {}),
              },
            },
          ];
        if (message.role === 'tool' && message.tool)
          return [
            {
              id: message.id,
              role: 'tool',
              text: message.tool.title || message.tool.name,
              status:
                message.tool.status === 'running'
                  ? 'running'
                  : message.tool.status === 'failed'
                    ? 'failed'
                    : 'completed',
            },
          ];
        return [];
      })
      .slice(-40);
    const lastUser = [...session.messages].reverse().find((message) => message.role === 'user');
    const approval = session.approval;
    return {
      id: session.id,
      title: session.title,
      agent: agentKind(session),
      status: session.status,
      ...(session.status === 'waiting' || approval
        ? {
            waitingFor:
              approval?.kind === 'plan'
                ? ('plan' as const)
                : approval?.questions?.length
                  ? ('question' as const)
                  : ('approval' as const),
          }
        : {}),
      messages,
      ...(session.status === 'running' && lastUser?.startedAt
        ? { startedAt: lastUser.startedAt }
        : {}),
    };
  }

  private links(): Record<string, string[]> {
    return this.context.state.get<Record<string, string[]>>(THREADS, {});
  }
  private require(target: PageTarget, threadId: string): void {
    const own =
      this.chats.get(chatKey(target)) === threadId ||
      Boolean(target.id && (this.links()[target.id] ?? []).includes(threadId));
    if (!own || !this.context.sessions.sessions.some((session) => session.id === threadId))
      throw new Error('That chat doesn’t belong to this page.');
  }
}

/**
 * The page editor receives what a chat surface would. It only needs to know which thread
 * started; everything else it reads from the page's state.
 */
function pageSurface(webview: vscode.Webview, started?: (threadId: string) => void): Surface {
  const post = (message: unknown) => {
    const sent = message as { type?: string; threadId?: unknown };
    if (sent?.type === 'sent' && typeof sent.threadId === 'string') started?.(sent.threadId);
    return Promise.resolve(true);
  };
  return { kind: 'panel', ready: true, webview: { ...webview, postMessage: post } };
}
/** Each page's chat, or a Markdown file's when it is opened with the page editor. */
function chatKey(target: PageTarget): string {
  return target.id ?? `file:${target.path ?? ''}`;
}
