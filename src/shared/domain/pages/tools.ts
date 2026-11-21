import { z } from 'zod';
import type { PageEdit } from './edits';
import { PAGE_ID, PAGE_TEXT_LIMIT } from './entry';
import { PAGE_TITLE_LIMIT } from './title';

/**
 * Tools an agent gets for your pages. It can read them, suggest edits, start a new page, and
 * add an image to a page's own assets. A suggestion changes nothing until you accept it in the
 * page; no tool writes your text.
 */
export const PAGE_TOOL_NAMES = [
  'pages_list',
  'pages_read',
  'pages_suggest_edit',
  'pages_create',
  'pages_add_image',
] as const;
export type PageToolName = (typeof PAGE_TOOL_NAMES)[number];
/** Tools that only read, and so are offered in Ask too. */
export const READ_ONLY_PAGE_TOOLS: readonly PageToolName[] = ['pages_list', 'pages_read'];

/** Runs one page tool for a thread and returns the text the agent receives. */
export type PageTools = (name: PageToolName, args: unknown) => Promise<string>;

const id = z.string().regex(PAGE_ID);
const edit = z.object({
  find: z.string().max(PAGE_TEXT_LIMIT),
  replace: z.string().max(PAGE_TEXT_LIMIT),
});
export const pageToolInput = {
  pages_list: z.object({}),
  pages_read: z.object({ id }),
  pages_suggest_edit: z.object({
    id,
    edits: z.array(edit).min(1).max(30),
    note: z.string().trim().max(500).optional(),
  }),
  pages_create: z.object({
    title: z.string().trim().min(1).max(PAGE_TITLE_LIMIT),
    markdown: z.string().max(PAGE_TEXT_LIMIT),
  }),
  pages_add_image: z.object({
    id,
    path: z.string().trim().min(1).max(4096),
    alt: z.string().trim().max(200).optional(),
  }),
} as const;

export const PAGE_TOOL_DESCRIPTIONS: Record<PageToolName, string> = {
  pages_list:
    "List the user's pages: their Markdown notes for this workspace, such as today's daily page " +
    '(id daily/YYYY-MM-DD), plans and notes. Each comes with its id, title, and open task count.',
  pages_read: 'Read one page as Markdown, by id.',
  pages_suggest_edit:
    'Suggest edits to a page. Each edit replaces one exact, unique piece of the current Markdown ' +
    '(`find`) with `replace`; an empty `find` appends to the end. Read the page first and copy ' +
    '`find` exactly. Nothing changes until the user accepts it in the page, so say what you ' +
    'suggested. To tick a task, replace `- [ ] task` with `- [x] task` only when it is truly done. ' +
    'Cite workspace files as links, `[adapter.ts](src/providers/claude/adapter.ts)`; they show as ' +
    'file chips the user can open. Mermaid diagrams in ```mermaid blocks are drawn in the page. ' +
    'To show an image, add it with pages_add_image first and use the Markdown it returns.',
  pages_create:
    'Create a new page with a title and Markdown body, for notes or a plan the user asked for. ' +
    'It is marked as written by you. Cite workspace files as Markdown links with ' +
    'workspace-relative paths.',
  pages_add_image:
    "Copy an image into a page's own assets so the page can show it, and get the Markdown to " +
    'use in pages_suggest_edit. `path` is an absolute path to a PNG, JPEG, GIF or WebP up to ' +
    '10 MB: a file in the workspace, or one you generated. Never save images into the ' +
    "workspace or repository for a page: pages live outside it, and the user's repository " +
    'should stay clean.',
};
export const PAGE_TOOL_TITLES: Record<PageToolName, string> = {
  pages_list: 'List your pages?',
  pages_read: 'Read a page?',
  pages_suggest_edit: 'Suggest edits to a page?',
  pages_create: 'Create a page?',
  pages_add_image: 'Add an image to a page?',
};

type JsonSchema = Record<string, unknown>;
export function pageToolJsonSchema(name: PageToolName): JsonSchema {
  const idSchema = { type: 'string', description: 'The page id from pages_list.' };
  const object = (properties: JsonSchema, required: string[]) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  switch (name) {
    case 'pages_list':
      return object({}, []);
    case 'pages_read':
      return object({ id: idSchema }, ['id']);
    case 'pages_suggest_edit':
      return object(
        {
          id: idSchema,
          edits: {
            type: 'array',
            items: object(
              {
                find: { type: 'string', description: 'Exact text to replace; empty appends.' },
                replace: { type: 'string', description: 'The new Markdown.' },
              },
              ['find', 'replace'],
            ),
          },
          note: { type: 'string', description: 'One line on why, shown with the suggestion.' },
        },
        ['id', 'edits'],
      );
    case 'pages_create':
      return object(
        {
          title: { type: 'string', description: 'The page title.' },
          markdown: { type: 'string', description: 'The body, without the title heading.' },
        },
        ['title', 'markdown'],
      );
    case 'pages_add_image':
      return object(
        {
          id: idSchema,
          path: { type: 'string', description: 'Absolute path to the image file.' },
          alt: { type: 'string', description: 'A short description of the image.' },
        },
        ['id', 'path'],
      );
  }
}

export function isPageTool(name: string): name is PageToolName {
  return (PAGE_TOOL_NAMES as readonly string[]).includes(name);
}

export type PageToolRequest =
  | { type: 'list' }
  | { type: 'read'; id: string }
  | { type: 'suggest'; id: string; edits: PageEdit[]; note?: string }
  | { type: 'create'; title: string; markdown: string }
  | { type: 'addImage'; id: string; path: string; alt?: string };
/** The request a tool call makes. Invalid arguments throw. */
export function parsePageTool(name: PageToolName, args: unknown): PageToolRequest {
  switch (name) {
    case 'pages_list':
      pageToolInput.pages_list.parse(args ?? {});
      return { type: 'list' };
    case 'pages_read':
      return { type: 'read', id: pageToolInput.pages_read.parse(args).id };
    case 'pages_suggest_edit': {
      const input = pageToolInput.pages_suggest_edit.parse(args);
      return {
        type: 'suggest',
        id: input.id,
        edits: input.edits,
        ...(input.note ? { note: input.note } : {}),
      };
    }
    case 'pages_create': {
      const input = pageToolInput.pages_create.parse(args);
      return { type: 'create', title: input.title, markdown: input.markdown };
    }
    case 'pages_add_image': {
      const input = pageToolInput.pages_add_image.parse(args);
      return {
        type: 'addImage',
        id: input.id,
        path: input.path,
        ...(input.alt ? { alt: input.alt } : {}),
      };
    }
  }
}
