import * as vscode from 'vscode';
import { textChange } from '../../shared/domain/pages/edits';

/** Replaces a document's text with the smallest edit, so undo and the cursor stay sensible. */
export async function replaceDocument(
  document: vscode.TextDocument,
  text: string,
): Promise<boolean> {
  const change = textChange(document.getText(), text);
  if (!change) return true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)),
    change.text,
  );
  return vscode.workspace.applyEdit(edit);
}

/** The resource an editor tab shows, for text and custom editors. */
export function tabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  return input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
    ? input.uri
    : undefined;
}
/** Every editor tab's resource, in every group. */
export function tabUris(): vscode.Uri[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map(tabUri).filter((uri): uri is vscode.Uri => Boolean(uri)),
  );
}
/** Closes every tab showing a resource that matches. */
export async function closeTabs(matches: (uri: vscode.Uri) => boolean): Promise<void> {
  for (const group of vscode.window.tabGroups.all)
    for (const tab of group.tabs) {
      const uri = tabUri(tab);
      if (uri && matches(uri)) await vscode.window.tabGroups.close(tab, true);
    }
}
