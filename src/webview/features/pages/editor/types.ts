import type { ColumnWidths } from './plugins/column-widths';
import type { BlockRanges } from './preserve';
import type { EditPlace } from './review-diff';

export type MarkKind = 'bold' | 'italic' | 'strike' | 'code';
/** What the selection's block can be turned into, as in Notion's "Turn into" menu. */
export type BlockKind =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'todo'
  | 'bullet'
  | 'number'
  | 'quote'
  | 'code';

/** Where an `@` mention is being typed, and what follows it. */
export interface MentionState {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}
export interface SelectionState {
  text: string;
  left: number;
  top: number;
  bottom: number;
  active: Record<MarkKind, boolean>;
  /** The kind of block the selection starts in. */
  block: BlockKind;
  /** The link the selection is in, if any. */
  href?: string;
}
export interface EditorEvents {
  change(markdown: string): void;
  mention(state: MentionState | undefined): void;
  /** While the mention menu is open, it gets the keys that move through it. */
  mentionKey(key: string): boolean;
  selection(state: SelectionState | undefined): void;
  link(href: string): void;
  /** The slash menu's "Link to page": the page chooser opens. */
  choosePage(): void;
  /** Saves a pasted, dropped or chosen image and resolves with its Markdown path. */
  upload(file: File): Promise<string>;
  /** The address the webview can load an image from. */
  imageUrl(src: string): string;
  /** Paths the page shows that may be workspace files; answer with `resolvedPaths`. */
  resolvePaths(paths: string[]): void;
  /** Accept or reject one suggested change, from its inline buttons. */
  review(key: string, accept: boolean): void;
  /** Column widths you dragged, to keep for this file; the Markdown is unchanged. */
  tableWidths(widths: ColumnWidths): void;
}
/** One suggested edit, placed in the page for review. */
export interface ReviewChange {
  key: string;
  /** Who suggested it, for the change's label. */
  agent: string;
  place: EditPlace;
}
export interface PageEditor {
  /** Column widths kept for this file, as the host last sent them. */
  setTableWidths(widths: ColumnWidths): void;
  /** Replaces everything, as when the page changed outside the editor. Fires no change. */
  setBody(markdown: string): void;
  body(): string;
  ranges: BlockRanges;
  /** Writes text at the cursor, replacing `range` (a typed `@query`) when given. */
  insertText(text: string, range?: { from: number; to: number }): void;
  /** Puts an image block after the block the cursor is in. */
  insertImage(src: string, alt: string): void;
  /** Writes linked text at the cursor, replacing `range` when given. */
  insertLink(text: string, href: string, range?: { from: number; to: number }): void;
  mark(kind: MarkKind): void;
  /** Turns the selection's block into another kind. */
  turnInto(kind: BlockKind): void;
  link(href: string): void;
  /** The host's answer to `resolvePaths`: which of `asked` are files. */
  resolvedPaths(asked: string[], files: string[]): void;
  /** Shows these suggested changes in place, replacing any shown before. */
  setChanges(changes: ReviewChange[]): void;
  /** Scrolls to a suggested change and flashes it. */
  showChange(key: string): void;
  outline(): { text: string; level: number; pos: number }[];
  reveal(pos: number): void;
  focus(): void;
  destroy(): Promise<void>;
}
