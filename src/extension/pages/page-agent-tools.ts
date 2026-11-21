import { randomBytes } from 'node:crypto';
import { localDay, PageNotFound, type PageStore } from '../../infrastructure/pages/page-store';
import { dailyId } from '../../shared/domain/pages/daily';
import { editFits, type PageSuggestion } from '../../shared/domain/pages/edits';
import { type PageEntry, pageForAgent } from '../../shared/domain/pages/entry';
import { type PageToolName, parsePageTool } from '../../shared/domain/pages/tools';
import { agentKind } from '../../shared/model';
import { importImage } from './page-assets';
import type { PagesContext } from './page-context';
import type { PageSuggestions } from './page-suggestions';
import type { PageThreads } from './page-threads';

export interface PageAgentToolsDeps {
  context: PagesContext;
  store: PageStore;
  suggestions: PageSuggestions;
  threads: PageThreads;
  /** The pages as last listed. */
  entries(): PageEntry[];
  /** The page's text, from its open document when there is one. */
  text(id: string): Promise<string>;
  refresh(): Promise<void>;
  /** Folders an agent may add images from: the workspace, and where generated images land. */
  imageRoots(): string[];
}

/**
 * What agents can do with your pages: list and read them, suggest edits you review, start a
 * new page, and add images to a page's assets. No tool changes your text by itself.
 */
export class PageAgentTools {
  constructor(private deps: PageAgentToolsDeps) {}

  /** A page as an agent reads it, for an @ attachment. */
  async forAgent(id: string): Promise<string> {
    const { store, entries, text } = this.deps;
    const entry = (await store.entry(id)) ?? entries().find((item) => item.id === id);
    if (!entry) throw new PageNotFound(id);
    return `${pageForAgent(entry, await text(id))}\n\nTo change this page, suggest edits with pages_suggest_edit (id: ${id}) if you have that tool; the user reviews them. To show an image on it, add the image with pages_add_image and use the Markdown it returns. This page lives outside the workspace, so never write files into the workspace or repository for it.`;
  }

  /** One page tool call from a thread's agent. */
  async run(threadId: string, name: PageToolName, args: unknown): Promise<string> {
    const { context, store, suggestions, threads, text } = this.deps;
    const request = parsePageTool(name, args);
    switch (request.type) {
      case 'list': {
        const entries = await store.list();
        const today = dailyId(localDay());
        if (!entries.length) return `The user has no pages yet. Today's page id would be ${today}.`;
        return [
          `Today's page: ${today}${entries.some((entry) => entry.id === today) ? '' : ' (not created yet)'}`,
          ...entries.map(
            (entry) =>
              `- ${entry.id}: ${entry.title}${entry.openTasks ? ` (${entry.openTasks} open tasks)` : ''}`,
          ),
        ].join('\n');
      }
      case 'read': {
        const entry = await store.entry(request.id);
        if (!entry) throw new PageNotFound(request.id);
        return pageForAgent(entry, await text(request.id));
      }
      case 'suggest': {
        const current = await text(request.id);
        request.edits.forEach((edit, index) => {
          if (!editFits(current, edit))
            throw new Error(
              `Edit ${index + 1}: \`find\` must match the page exactly once. Read the page again and copy it exactly.`,
            );
        });
        const session = context.sessions.sessions.find((item) => item.id === threadId);
        const suggestion: PageSuggestion = {
          id: randomBytes(5).toString('hex'),
          pageId: request.id,
          edits: request.edits,
          ...(request.note ? { note: request.note } : {}),
          agent: session ? agentKind(session) : 'claude',
          threadId,
          createdAt: Date.now(),
        };
        await suggestions.add(suggestion);
        await threads.linkPages(threadId, [request.id]);
        const entry = await store.entry(request.id);
        return `Suggested ${request.edits.length} ${request.edits.length === 1 ? 'edit' : 'edits'} to “${entry?.title ?? request.id}”. Nothing has changed yet: the user reviews them in the page.`;
      }
      case 'create': {
        const id = await store.create(request.title, request.markdown, { by: 'agent' });
        await threads.linkPages(threadId, [id]);
        await this.deps.refresh();
        return `Created the page “${request.title}” (id: ${id}). The user can open it from Pages.`;
      }
      case 'addImage': {
        if (!(await store.exists(request.id))) throw new PageNotFound(request.id);
        const src = await importImage(
          store.assets,
          request.id,
          request.path,
          this.deps.imageRoots(),
        );
        const alt = (request.alt ?? '').replace(/[[\]\n]/g, ' ').trim();
        return `Saved the image with the page. Nothing on the page has changed yet: to show it, suggest an edit with pages_suggest_edit that adds this Markdown where it belongs:\n\n![${alt}](${src})`;
      }
    }
  }
}
