import * as vscode from 'vscode';
import { localDay } from '../../infrastructure/pages/page-store';
import type { PageEntry } from '../../shared/domain/pages/entry';
import { appendTasks } from '../../shared/domain/pages/tasks';
import type { Pages } from './pages';

/** Adds a task to today's page, linked to the selection in the active editor if there is one. */
export async function addToToday(pages: Pages): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let reference = '';
  let value = '';
  if (editor && !editor.selection.isEmpty) {
    const relative = vscode.workspace.asRelativePath(editor.document.uri);
    const line = editor.selection.start.line + 1;
    reference = ` (\`${relative}:${line}\`)`;
    value = editor.document.getText(editor.selection).split('\n')[0]?.trim().slice(0, 200) ?? '';
  }
  const text = await vscode.window.showInputBox({
    title: 'Add a task to today’s page',
    value,
    prompt: reference ? `Links to ${reference.slice(3, -2)}` : undefined,
    validateInput: (input) => (input.trim() ? undefined : 'Write the task first.'),
  });
  if (!text?.trim()) return;
  const id = await pages.store.daily(localDay());
  await pages.change(id, (page) =>
    appendTasks(page, `- [ ] ${text.replace(/\s+/g, ' ').trim()}${reference}`),
  );
  const open = 'Open Today';
  void vscode.window
    .showInformationMessage('Added to today’s page.', open)
    .then((choice) => (choice === open ? pages.open(id) : undefined));
}

/** Not a page id (those never start with `:`), so it can't clash with one. */
const ALL_PAGES = ':all';

/** Pick a page to open, start a new one, or see them all. */
export function searchPages(pages: Pages): void {
  const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { id?: string }>();
  pick.placeholder = 'Search your pages';
  pick.matchOnDescription = true;
  pick.matchOnDetail = true;
  const show = (entries: { entry: PageEntry; excerpt?: string }[]) => {
    pick.items = [
      { label: '$(add) New page', alwaysShow: true },
      { id: ALL_PAGES, label: '$(list-flat) All pages', alwaysShow: true },
      ...entries.map(({ entry, excerpt }) => ({
        id: entry.id,
        label: `${entry.icon ?? '📄'} ${entry.title}`,
        description: entry.day ? 'Daily' : undefined,
        detail: excerpt,
      })),
    ];
  };
  show(pages.list.map((entry) => ({ entry })));
  let search = 0;
  pick.onDidChangeValue(async (value) => {
    const mine = ++search;
    const results = value.trim()
      ? await pages.store.search(value)
      : pages.list.map((entry) => ({ entry }));
    if (mine === search) show(results);
  });
  pick.onDidAccept(() => {
    const item = pick.selectedItems[0];
    pick.hide();
    if (!item) return;
    if (item.id === ALL_PAGES) pages.openOverview();
    else void (item.id ? pages.open(item.id) : pages.newPage());
  });
  pick.onDidHide(() => pick.dispose());
  pick.show();
}
