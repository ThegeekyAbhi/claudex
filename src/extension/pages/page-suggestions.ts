import type * as vscode from 'vscode';
import { applyPageEdit, type PageSuggestion } from '../../shared/domain/pages/edits';

const SUGGESTIONS = 'pages.suggestions';

/**
 * Edits agents suggested to your pages, kept until you accept or dismiss them. Nothing here
 * changes a page by itself: accepting goes through the change the caller passes in.
 */
export class PageSuggestions {
  constructor(
    private state: vscode.Memento,
    /** The list changed: page editors redraw. */
    private changed: () => void,
  ) {}

  all(): PageSuggestion[] {
    return this.state.get<PageSuggestion[]>(SUGGESTIONS, []);
  }
  forPage(id: string): PageSuggestion[] {
    return this.all().filter((item) => item.pageId === id);
  }
  async add(suggestion: PageSuggestion): Promise<void> {
    await this.save([...this.all(), suggestion]);
  }
  /** Accepts or dismisses one edit of a suggestion, or all of it. */
  async resolve(
    id: string,
    accept: boolean,
    index: number | undefined,
    change: (pageId: string, update: (text: string) => string) => Promise<void>,
  ): Promise<void> {
    const list = this.all();
    const suggestion = list.find((item) => item.id === id);
    if (!suggestion) throw new Error('That suggestion is gone.');
    const chosen = index === undefined ? suggestion.edits : [suggestion.edits[index]];
    if (chosen.some((edit) => !edit)) throw new Error('That suggestion is gone.');
    if (accept)
      await change(suggestion.pageId, (text) =>
        chosen.reduce((current, edit) => applyPageEdit(current, edit), text),
      );
    const left = index === undefined ? [] : suggestion.edits.filter((_, at) => at !== index);
    await this.save(
      left.length
        ? list.map((item) => (item.id === id ? { ...item, edits: left } : item))
        : list.filter((item) => item.id !== id),
    );
  }
  private async save(list: PageSuggestion[]): Promise<void> {
    await this.state.update(SUGGESTIONS, list);
    this.changed();
  }
}
