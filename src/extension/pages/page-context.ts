import type * as vscode from 'vscode';
import type { Sessions } from '../../application/sessions/session-manager';
import type { Action, BuildChoice } from '../../shared/model';
import type { PagePlan } from '../../shared/protocol/pages';
import type { Surface } from '../surfaces';

/** What Pages needs from the rest of the extension. */
export interface PagesContext {
  extensionUri: vscode.Uri;
  storage: string;
  state: vscode.Memento;
  /** Settings shared by every workspace, such as how wide pages are. */
  globalState: vscode.Memento;
  output: vscode.OutputChannel;
  sessions: Sessions;
  startThread(action: Extract<Action, { type: 'start' }>, surface: Surface): Promise<void>;
  /** A follow-up to a thread, with the same checks as the chat's composer. */
  send(threadId: string, text: string, surface: Surface): Promise<void>;
  /** Stops a thread's running turn, as the chat's stop button does. */
  interrupt(threadId: string, surface: Surface): Promise<void>;
  /** Workspace files matching a query, for an `@` mention in a page. */
  searchFiles(query: string): Promise<{ path: string; name: string }[]>;
  /** The folder workspace-relative paths in a page resolve against. */
  workspaceRoot(): string | undefined;
  openChat(id: string): Promise<void>;
  link(href: string): Promise<void>;
  /** Your pages changed: the chat's @ menu lists them. */
  changed(): void;
  /** The thread whose plan is this file, as the page's Build bar shows it. */
  planFor(file: string): PagePlan | undefined;
  /** Builds a thread's plan as the chat's plan bar does, showing that thread in the chat. */
  buildPlan(threadId: string, choice: BuildChoice): Promise<void>;
}

/** A page by id, or a Markdown file opened with the page editor, by path. */
export interface PageTarget {
  id?: string;
  path?: string;
}
