import { Crepe } from '@milkdown/crepe';
import {
  commandsCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/kit/core';
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { inputRules } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { DecorationSet } from '@milkdown/kit/prose/view';
import { $prose, getMarkdown, replaceAll } from '@milkdown/kit/utils';
import { crepeConfig } from './crepe-config';
import { diagramPreviews } from './diagram-previews';
import { turnInto } from './plugins/blocks';
import {
  type ColumnWidths,
  columnWidthsKey,
  columnWidthsPlugin,
  loadColumnWidths,
} from './plugins/column-widths';
import { chipDecorations, chipKey, openChip, pathRefs } from './plugins/file-chips';
import { pageImageView } from './plugins/image-view';
import { openLink } from './plugins/links';
import { insertLink, mentionAt } from './plugins/mentions';
import { reviewDecorations, reviewKey } from './plugins/review';
import { selectionAt } from './plugins/selection';
import { taskRule, toggleTaskAt } from './plugins/tasks';
import type { EditorEvents, PageEditor } from './types';

const pageKey = new PluginKey('page-editor');

/**
 * Asks the host which path references are workspace files, a batch at a time, and remembers
 * the answers so file chips draw without asking again.
 */
function pathLookup(resolve: (paths: string[]) => void) {
  const known = new Map<string, boolean>();
  const asking = new Set<string>();
  let timer = 0;
  return {
    known,
    ask(refs: string[]) {
      const fresh = refs.filter((ref) => !known.has(ref) && !asking.has(ref));
      if (!fresh.length) return;
      for (const ref of fresh) asking.add(ref);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const batch = [...asking].filter((ref) => !known.has(ref)).slice(0, 200);
        if (batch.length) resolve(batch);
      }, 150);
    },
    answered(asked: string[], files: string[]) {
      const found = new Set(files);
      for (const ref of asked) {
        asking.delete(ref);
        known.set(ref, found.has(ref));
      }
    },
    dispose() {
      window.clearTimeout(timer);
    },
  };
}

/** The page editor: Markdown in, Markdown out, with your blocks kept as you wrote them. */
export async function createPageEditor(
  root: HTMLElement,
  body: string,
  events: EditorEvents,
  tableWidths: ColumnWidths = [],
): Promise<PageEditor> {
  let quiet = false;
  const diagrams = diagramPreviews(root);
  const paths = pathLookup(events.resolvePaths);
  // Images added in this session start at their default size once they load.
  const fresh = new Set<string>();
  const upload = async (file: File) => {
    const src = await events.upload(file);
    fresh.add(src);
    return src;
  };
  const crepe = new Crepe(crepeConfig(root, body, { ...events, upload }, diagrams.render));
  crepe.editor
    .config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: '-' as const,
        rule: '-' as const,
        fences: true,
      }));
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        attributes: { class: 'page-prose', spellcheck: 'true', 'aria-label': 'Page' },
      }));
    })
    .use(
      $prose(
        () =>
          new Plugin({
            key: pageKey,
            props: {
              handleKeyDown: (_view, event) => {
                if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(event.key))
                  return events.mentionKey(event.key);
                return false;
              },
              handleDOMEvents: {
                mousedown: (_view, event) => openChip(event, events.link),
                blur: (_view, event) => {
                  // The selection bar's own fields keep it; anywhere else puts it away.
                  const next = event.relatedTarget as HTMLElement | null;
                  if (!next?.closest?.('.page-selection-bar')) events.selection(undefined);
                  return false;
                },
                click: (_view, event) => {
                  if ((event.target as HTMLElement | null)?.closest?.('[data-file]')) return true;
                  return openLink(event, events.link);
                },
              },
            },
            view: (view) => {
              paths.ask(pathRefs(view.state.doc));
              return {
                update: (current, previous) => {
                  events.mention(mentionAt(current));
                  events.selection(selectionAt(current));
                  if (!current.state.doc.eq(previous.doc)) paths.ask(pathRefs(current.state.doc));
                },
              };
            },
          }),
      ),
    )
    .use(pageImageView(events.imageUrl, fresh))
    .use($prose(() => inputRules({ rules: [taskRule] })))
    .use($prose(() => columnWidthsPlugin(tableWidths, events.tableWidths)))
    .use(
      $prose(() =>
        keymap({
          'Mod-Enter': (state, dispatch) => toggleTaskAt(state, dispatch),
        }),
      ),
    )
    .use(
      $prose(
        () =>
          new Plugin<DecorationSet>({
            key: chipKey,
            state: {
              init: (_config, state) => chipDecorations(state, paths.known),
              apply: (tr, set, _old, state) =>
                tr.docChanged || tr.selectionSet || tr.getMeta(chipKey)
                  ? chipDecorations(state, paths.known)
                  : set,
            },
            props: { decorations: (state) => chipKey.getState(state) },
          }),
      ),
    )
    .use(
      $prose(
        () =>
          new Plugin<DecorationSet>({
            key: reviewKey,
            state: {
              init: () => DecorationSet.empty,
              apply: (tr, set) =>
                (tr.getMeta(reviewKey) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
            },
            props: { decorations: (state) => reviewKey.getState(state) },
          }),
      ),
    );
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, previous) => {
      if (!quiet && markdown !== previous) events.change(markdown);
    });
  });
  await crepe.create();

  const editor = crepe.editor;
  const view = () => editor.action((ctx) => ctx.get(editorViewCtx));
  const replace = (range?: { from: number; to: number }) => {
    const current = view();
    return range ? current.state.tr.delete(range.from, range.to) : current.state.tr;
  };
  return {
    setBody(markdown) {
      quiet = true;
      try {
        editor.action(replaceAll(markdown, true));
      } finally {
        quiet = false;
      }
    },
    body: () => editor.action(getMarkdown()),
    ranges: (markdown) => {
      const tree = editor.action((ctx) => ctx.get(remarkCtx).parse(markdown));
      return tree.children.flatMap((node) =>
        node.position?.start.offset !== undefined && node.position.end.offset !== undefined
          ? [{ start: node.position.start.offset, end: node.position.end.offset }]
          : [],
      );
    },
    insertText(text, range) {
      const current = view();
      current.dispatch(replace(range).insertText(text));
      current.focus();
    },
    insertImage(src, alt) {
      const current = view();
      const { schema, selection } = current.state;
      const block = schema.nodes['image-block'];
      const node = block
        ? block.create({ src, caption: alt, ratio: 1 })
        : schema.nodes.paragraph?.create(null, schema.nodes.image?.create({ src, alt }));
      if (!node) return;
      fresh.add(src);
      // After the top-level block the cursor is in, or at the end when nothing is focused.
      const at =
        current.hasFocus() && selection.$from.depth >= 1
          ? selection.$from.after(1)
          : current.state.doc.content.size;
      const tr = current.state.tr.insert(at, node);
      current.dispatch(tr.scrollIntoView());
    },
    insertLink(text, href, range) {
      insertLink(view(), text, href, range);
    },
    mark(kind) {
      const key = {
        bold: toggleStrongCommand.key,
        italic: toggleEmphasisCommand.key,
        strike: toggleStrikethroughCommand.key,
        code: toggleInlineCodeCommand.key,
      }[kind];
      editor.action((ctx) => ctx.get(commandsCtx).call(key));
      view().focus();
    },
    turnInto(kind) {
      turnInto(editor, view, kind);
    },
    link(href) {
      const current = view();
      const { from, to } = current.state.selection;
      const type = current.state.schema.marks.link;
      if (!type || from === to) return;
      const tr = href
        ? current.state.tr.addMark(from, to, type.create({ href }))
        : current.state.tr.removeMark(from, to, type);
      current.dispatch(tr);
      current.focus();
    },
    resolvedPaths(asked, files) {
      paths.answered(asked, files);
      const current = view();
      current.dispatch(current.state.tr.setMeta(chipKey, true).setMeta('addToHistory', false));
    },
    setChanges(changes) {
      const current = view();
      const set = editor.action((ctx) =>
        reviewDecorations(
          current.state,
          changes,
          ctx.get(parserCtx),
          events.review,
          events.imageUrl,
        ),
      );
      current.dispatch(current.state.tr.setMeta(reviewKey, set).setMeta('addToHistory', false));
    },
    showChange(key) {
      const element = view().dom.querySelector<HTMLElement>(`[data-change="${CSS.escape(key)}"]`);
      if (!element) return;
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.classList.remove('page-change-flash');
      void element.offsetWidth;
      element.classList.add('page-change-flash');
    },
    outline() {
      const headings: { text: string; level: number; pos: number }[] = [];
      view().state.doc.forEach((node, offset) => {
        if (node.type.name === 'heading' && node.textContent.trim())
          headings.push({ text: node.textContent, level: node.attrs.level as number, pos: offset });
      });
      return headings;
    },
    reveal(pos) {
      const current = view();
      const selection = TextSelection.near(
        current.state.doc.resolve(Math.min(pos + 1, current.state.doc.content.size)),
      );
      current.dispatch(current.state.tr.setSelection(selection).scrollIntoView());
      current.focus();
    },
    focus: () => view().focus(),
    setTableWidths: (widths) => {
      const current = view();
      if (JSON.stringify(columnWidthsKey.getState(current.state)) !== JSON.stringify(widths))
        loadColumnWidths(current, widths);
    },
    destroy: async () => {
      diagrams.destroy();
      paths.dispose();
      await crepe.destroy();
    },
  };
}
