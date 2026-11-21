import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Crepe, type CrepeConfig } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorView } from '@milkdown/kit/prose/view';
import { localDate } from '../shared/local-date';
import { LIST_ICONS, slashIcon } from '../shared/slash-icons';
import type { EditorEvents } from './types';

/**
 * CodeMirror's languages plus Mermaid, which has no grammar there. Its name stays lowercase so the
 * fence reads ```mermaid and renders as a diagram outside Claudex too.
 */
const CODE_LANGUAGES = [
  ...languages,
  LanguageDescription.of({
    name: 'mermaid',
    alias: ['mmd'],
    extensions: ['mmd', 'mermaid'],
    support: new LanguageSupport(
      StreamLanguage.define({
        name: 'mermaid',
        token(stream) {
          stream.skipToEnd();
          return null;
        },
      }),
    ),
  }),
];

/** Crepe as pages use it: the blocks and menus offered, and how code and images behave. */
export function crepeConfig(
  root: HTMLElement,
  body: string,
  events: EditorEvents,
  renderPreview: (
    language: string,
    content: string,
    apply: (value: null | string | HTMLElement) => void,
  ) => null | undefined,
): CrepeConfig {
  return {
    root,
    defaultValue: body,
    features: {
      [Crepe.Feature.Toolbar]: false,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.AI]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: "Type '/' for blocks, '@' to mention",
        mode: 'block',
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: 'Basic blocks',
          text: { label: 'Text', icon: slashIcon('text', 'Plain writing') },
          h1: { label: 'Heading 1', icon: slashIcon('h1', 'Big section heading') },
          h2: { label: 'Heading 2', icon: slashIcon('h2', 'Medium heading') },
          h3: { label: 'Heading 3', icon: slashIcon('h3', 'Small heading') },
          h4: null,
          h5: null,
          h6: null,
          quote: { label: 'Quote', icon: slashIcon('quote', 'Capture a quote') },
          divider: { label: 'Divider', icon: slashIcon('divider', 'Separate sections') },
        },
        listGroup: {
          label: 'Lists',
          bulletList: { label: 'Bulleted list', icon: slashIcon('bullets', 'Simple list') },
          orderedList: { label: 'Numbered list', icon: slashIcon('numbers', 'Ordered steps') },
          taskList: { label: 'To-do list', icon: slashIcon('todo', 'Track tasks') },
        },
        advancedGroup: {
          label: 'Media',
          image: { label: 'Image', icon: slashIcon('image', 'Upload or paste') },
          codeBlock: { label: 'Code', icon: slashIcon('code', 'Snippet or diagram') },
          table: { label: 'Table', icon: slashIcon('table', 'Rows and columns') },
          math: null,
        },
        buildMenu: (builder) => {
          builder
            .addGroup('insert', 'Insert')
            .addItem('mention', {
              label: 'Mention',
              icon: slashIcon('mention', 'Page, file or date'),
              onRun: (ctx: Ctx) => {
                const view = clearSlash(ctx);
                view.dispatch(view.state.tr.insertText('@'));
                view.focus();
              },
            })
            .addItem('pageLink', {
              label: 'Link to page',
              icon: slashIcon('page', 'Link another page'),
              onRun: (ctx: Ctx) => {
                clearSlash(ctx);
                events.choosePage();
              },
            })
            .addItem('date', {
              label: 'Today’s date',
              icon: slashIcon('date', 'Insert the date'),
              onRun: (ctx: Ctx) => {
                const view = clearSlash(ctx);
                view.dispatch(view.state.tr.insertText(localDate(new Date())));
                view.focus();
              },
            });
        },
      },
      [Crepe.Feature.ListItem]: LIST_ICONS,
      [Crepe.Feature.CodeMirror]: {
        previewOnlyByDefault: true,
        previewLabel: 'Preview',
        previewLoading: '<span class="page-diagram-loading">Drawing diagram…</span>',
        languages: CODE_LANGUAGES,
        previewToggleText: (previewOnly: boolean) => (previewOnly ? 'Edit' : 'Done'),
        renderPreview,
      },
      [Crepe.Feature.ImageBlock]: {
        onUpload: events.upload,
        proxyDomURL: events.imageUrl,
        blockCaptionPlaceholderText: 'Add a caption',
        blockUploadPlaceholderText: 'or paste a link',
        inlineUploadPlaceholderText: 'or paste a link',
      },
    },
  };
}

/** Removes the `/query` typed to open the slash menu, and returns the view to write in. */
export function clearSlash(ctx: Ctx): EditorView {
  const view = ctx.get(editorViewCtx);
  const { $from, from } = view.state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = /\/[^\s/]*$/.exec(before);
  if (match) view.dispatch(view.state.tr.delete(from - match[0].length, from));
  return view;
}
