import type { PageViewState } from '../../../../../shared/protocol/pages';
import type { IconName } from '../../../../components/icons';
import type { MentionState, PageEditor } from '../../editor/types';
import { localDate } from '../../shared/local-date';
import { pageHref } from '../../shared/page-bridge';

export interface MentionItem {
  key: string;
  label: string;
  detail?: string;
  icon: IconName | { emoji: string };
  run(editor: PageEditor, mention: MentionState): void;
}
export interface MentionGroup {
  label: string;
  items: MentionItem[];
}

/** What `@` offers: your pages, workspace files, and dates. */
export function mentionItems(
  state: PageViewState | undefined,
  query: string,
  files: { path: string; name: string }[],
  now = new Date(),
): MentionGroup[] {
  const needle = query.toLowerCase();
  const pages = (state?.pages ?? [])
    .filter((page) => page.id !== state?.id && page.title.toLowerCase().includes(needle))
    .slice(0, 5)
    .map(
      (page): MentionItem => ({
        key: `page:${page.id}`,
        label: page.title,
        icon: { emoji: page.icon ?? '📄' },
        run: (editor, mention) =>
          editor.insertLink(page.title, pageHref(state?.id, page.id), mention),
      }),
    );
  const fileItems = files.slice(0, 8).map(
    (file): MentionItem => ({
      key: `file:${file.path}`,
      label: file.name,
      detail: file.path,
      icon: 'file',
      run: (editor, mention) => editor.insertLink(file.name, encodeURI(file.path), mention),
    }),
  );
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const dates = [
    { key: 'today', label: 'Today', value: localDate(now) },
    { key: 'tomorrow', label: 'Tomorrow', value: localDate(tomorrow) },
  ]
    .filter((date) => !needle || date.label.toLowerCase().startsWith(needle))
    .map(
      (date): MentionItem => ({
        key: `date:${date.key}`,
        label: date.label,
        detail: date.value,
        icon: 'calendar',
        run: (editor, mention) => editor.insertText(date.value, mention),
      }),
    );
  return [
    { label: 'Pages', items: pages },
    { label: 'Files', items: fileItems },
    { label: 'Date', items: dates },
  ].filter((group) => group.items.length);
}
