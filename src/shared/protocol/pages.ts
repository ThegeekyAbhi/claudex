import { z } from 'zod';
import type { AgentKind, Status } from '../domain/agents';
import type { PageSuggestion } from '../domain/pages/edits';
import { PAGE_ID, PAGE_TEXT_LIMIT, type PageEntry } from '../domain/pages/entry';
import { PAGE_ICONS } from '../domain/pages/meta';
import { PAGE_STARTERS } from '../domain/pages/starters';
import { PAGE_TITLE_LIMIT } from '../domain/pages/title';
import type { AgentProfile } from '../domain/profiles';
import { type Catalog, IMAGE_FILE } from '../domain/session';
import { buildChoice } from './actions';

const id = z.string().regex(PAGE_ID);
export const PAGE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** 10 MB of image, as base64. */
export const PAGE_IMAGE_BYTES = 10 * 1024 * 1024;
const PAGE_IMAGE_BASE64_LIMIT = Math.ceil(PAGE_IMAGE_BYTES / 3) * 4;
const icon = z.enum(PAGE_ICONS).optional();
export const PAGE_WIDTHS = ['normal', 'full'] as const;
export type PageWidth = (typeof PAGE_WIDTHS)[number];
/** Column widths you dragged, per table in document order; 0 leaves a column automatic. */
export const tableWidthsSchema = z
  .array(z.array(z.number().int().min(0).max(2000)).max(30).nullable())
  .max(50);
export type TableWidths = z.infer<typeof tableWidthsSchema>;

export const PAGES_SORTS = ['updated', 'title'] as const;
export const PAGES_FILTERS = ['all', 'pinned', 'daily', 'trash'] as const;
/** How the All pages view is sorted and filtered, kept per workspace. */
export interface PagesOverviewView {
  sort: (typeof PAGES_SORTS)[number];
  filter: (typeof PAGES_FILTERS)[number];
}
export const DEFAULT_OVERVIEW_VIEW: PagesOverviewView = { sort: 'updated', filter: 'all' };

/** What the Pages side bar and the All pages view may ask for. They never run an agent. */
export const pagesListActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('pageOpen'), id }),
  z.object({
    type: z.literal('pageNew'),
    /** From the New page dialog. Without a title, the host asks for one itself. */
    title: z.string().trim().min(1).max(PAGE_TITLE_LIMIT).optional(),
    icon,
    starter: z.enum(PAGE_STARTERS).optional(),
  }),
  z.object({ type: z.literal('pageToday') }),
  z.object({
    type: z.literal('pageRename'),
    id,
    title: z.string().trim().min(1).max(PAGE_TITLE_LIMIT),
  }),
  z.object({ type: z.literal('pagePin'), id, pinned: z.boolean() }),
  z.object({ type: z.literal('pageDuplicate'), id }),
  z.object({ type: z.literal('pageTrash'), id }),
  z.object({ type: z.literal('pageRestore'), id }),
  z.object({ type: z.literal('pageDeleteForever'), id }),
  z.object({ type: z.literal('pageOpenText'), id }),
  z.object({ type: z.literal('pageSearch'), query: z.string().max(200) }),
  /** Opens every page in a tab of its own. */
  z.object({ type: z.literal('pagesOverview') }),
  z.object({
    type: z.literal('pagesOverviewView'),
    sort: z.enum(PAGES_SORTS),
    filter: z.enum(PAGES_FILTERS),
  }),
]);
export type PagesListAction = z.infer<typeof pagesListActionSchema>;

/** What a page editor may ask for. Agent work needs a trusted workspace. */
export const pageViewActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  /** The whole page as it is now, after an edit in the editor. */
  z.object({ type: z.literal('pageEdit'), text: z.string().max(PAGE_TEXT_LIMIT) }),
  /** Starts a thread about this page with your message. */
  z.object({
    type: z.literal('pageAsk'),
    prompt: z.string().trim().min(1).max(20_000),
    profile: z.string().max(80).optional(),
    mode: z.enum(['ask', 'auto']).optional(),
  }),
  /** Accept or dismiss one edit of a suggestion, or all of it without `index`. */
  z.object({
    type: z.literal('pageSuggestion'),
    id: z.string().max(40),
    accept: z.boolean(),
    index: z.number().int().min(0).max(100).optional(),
  }),
  /** Move unfinished tasks from the last daily page here. */
  z.object({ type: z.literal('pageCarry') }),
  z.object({ type: z.literal('pageIcon'), icon }),
  z.object({ type: z.literal('pageOpenText') }),
  z.object({ type: z.literal('pageOpen'), id }),
  z.object({ type: z.literal('openChat'), id: z.string().max(200) }),
  z.object({ type: z.literal('link'), href: z.string().max(4096) }),
  /** Workspace files for an `@` mention. */
  z.object({
    type: z.literal('pageSearchFiles'),
    requestId: z.string().max(40),
    query: z.string().max(200),
  }),
  /** Which paths the page shows are workspace files, so they read as file chips. */
  z.object({
    type: z.literal('pageResolvePaths'),
    requestId: z.string().max(40),
    paths: z.array(z.string().min(1).max(500)).max(200),
  }),
  /** A pasted, dropped or chosen image, saved beside your pages. */
  z.object({
    type: z.literal('pageImage'),
    requestId: z.string().max(40),
    name: z.string().max(200),
    mime: z.enum(PAGE_IMAGE_TYPES),
    data: z.string().max(PAGE_IMAGE_BASE64_LIMIT),
  }),
  /** A follow-up in the page's chat, to one of its own threads. */
  z.object({
    type: z.literal('pageReply'),
    threadId: z.string().max(200),
    prompt: z.string().trim().min(1).max(20_000),
  }),
  z.object({ type: z.literal('pageStop'), threadId: z.string().max(200) }),
  /** An image from the page's chat, copied into the page's assets and placed at the cursor. */
  z.object({
    type: z.literal('pageAddChatImage'),
    file: z.string().regex(IMAGE_FILE),
    alt: z.string().max(200).optional(),
  }),
  /** Shows one of the page's threads in its chat, or none to start a new one. */
  z.object({ type: z.literal('pageThread'), threadId: z.string().max(200).optional() }),
  /** Opens the All pages view, from the link at the top of every page. */
  z.object({ type: z.literal('pageAllPages') }),
  /** Pages at their reading width, or across the whole editor. One choice for every page. */
  z.object({ type: z.literal('pageWidth'), width: z.enum(PAGE_WIDTHS) }),
  /** How wide you dragged this document's table columns; kept on this machine, not in the file. */
  z.object({ type: z.literal('pageTableWidths'), widths: tableWidthsSchema }),
  /** Builds the plan this page shows, with the same checks as the chat's plan bar. */
  z.object({ type: z.literal('pagePlanBuild'), threadId: z.string().max(200), ...buildChoice }),
]);
export type PageViewAction = z.infer<typeof pageViewActionSchema>;

/** A thread started from a page, as the page shows it. */
export interface PageThread {
  id: string;
  title: string;
  agent: AgentKind;
  status: Status;
  updatedAt: number;
}
export interface PageAgentChoice {
  /** Profile id. */
  id: string;
  label: string;
  agent: AgentKind;
}

export interface PagesListState {
  today: string;
  todayId: string;
  pages: PageEntry[];
  /** Page ids, most recently opened first. */
  recents: string[];
  trash: PageEntry[];
  /** The page in the active editor tab. */
  activeId?: string;
  /** How the All pages view was last sorted and filtered. */
  overview: PagesOverviewView;
}
/** One entry of the page's chat, as the page shows it. */
export interface PageChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'image';
  text: string;
  /** For an image an agent made: its file in the chat's image store. */
  image?: { file: string; prompt?: string };
  /** For a tool step, whether it is still going. */
  status?: 'running' | 'completed' | 'failed';
}
/** The thread the page's chat shows. */
export interface PageConversation {
  id: string;
  title: string;
  agent: AgentKind;
  status: Status;
  /** It is waiting on you for something the page can't answer; the chat can. */
  waitingFor?: 'approval' | 'question' | 'plan';
  messages: PageChatMessage[];
  /** When the current turn started, for "Working for Ns". */
  startedAt?: number;
}
/** A thread's plan, when the page shows its file: what the Build bar needs. */
export interface PagePlan {
  threadId: string;
  /** The thread's agent, e.g. "Claude". */
  agentLabel: string;
  /** The thread's model, if known. */
  model?: string;
  status: 'drafting' | 'ready' | 'incomplete' | 'approved';
  /** Only Claude Code can ask before each edit. */
  manualAllowed: boolean;
  /** The thread can take the decision now: the plan is finished and nothing else is running. */
  canBuild: boolean;
  /** The thread's agent: what builds in this thread, and the new chat's first choice. */
  agent: AgentKind;
  /** Every agent a new chat could use, as the chat's model picker lists them. */
  profiles: AgentProfile[];
  /** Their models, with descriptions and efforts, as the chat's model picker shows them. */
  catalog: Catalog;
}
export interface PageViewState {
  /** Unset for a Markdown file outside your pages, opened with the page editor. */
  id?: string;
  /** For a file outside your pages, its path relative to the workspace. */
  path?: string;
  text: string;
  /** Unfinished tasks on the last daily page, offered on today's. */
  carry?: { from: string; title: string; count: number };
  suggestions: PageSuggestion[];
  threads: PageThread[];
  agents: PageAgentChoice[];
  defaultProfile?: string;
  /** For links to other pages. */
  pages: { id: string; title: string; icon?: string }[];
  trusted: boolean;
  /** Where the page's images load from: relative image paths resolve against it. */
  assetBase?: string;
  /** Where images in the page's chat load from. */
  imageBase?: string;
  /** The chat shown in the page, if one is open. */
  conversation?: PageConversation;
  width: PageWidth;
  tableWidths: TableWidths;
  /** Set when this file is a thread's plan. */
  plan?: PagePlan;
}

export type PagesHostMessage =
  | { type: 'pages'; state: PagesListState }
  | {
      type: 'pageSearchResults';
      query: string;
      results: { entry: PageEntry; excerpt?: string }[];
    }
  | { type: 'error'; text: string };
export type PageHostMessage =
  | { type: 'page'; state: PageViewState }
  /** The document changed outside the editor: in a text tab, on disk, or by an accept. */
  | { type: 'pageText'; text: string }
  | { type: 'pageFileResults'; requestId: string; matches: { path: string; name: string }[] }
  | { type: 'pagePathsResolved'; requestId: string; paths: string[] }
  | { type: 'pageImageSaved'; requestId: string; src: string }
  | { type: 'pageImageFailed'; requestId: string; text: string }
  /** A chat image was saved with the page: put it where the cursor is. */
  | { type: 'pageInsertImage'; src: string; alt: string }
  | { type: 'error'; text: string };
