import { type CmdKey, commandsCtx, type Editor } from '@milkdown/kit/core';
import {
  createCodeBlockCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import type { EditorState } from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { BlockKind } from '../types';

/** The kind of block the selection starts in. */
export function blockKind(state: EditorState): BlockKind {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === 'list_item') {
      if (node.attrs.checked != null) return 'todo';
      return $from.node(depth - 1).type.name === 'ordered_list' ? 'number' : 'bullet';
    }
    if (name === 'blockquote') return 'quote';
  }
  const parent = $from.parent;
  if (parent.type.name === 'heading') {
    const level = Number(parent.attrs.level);
    return level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  }
  if (parent.type.name === 'code_block') return 'code';
  return 'text';
}

/** Lifts the selection's text out of any list or quote, so it can be wrapped afresh. */
export function unwrapAt(view: EditorView): void {
  for (let tries = 0; tries < 6; tries++) {
    const { $from, $to } = view.state.selection;
    let wrapped = false;
    for (let depth = $from.depth; depth > 0; depth--)
      if (['list_item', 'blockquote'].includes($from.node(depth).type.name)) wrapped = true;
    if (!wrapped) return;
    const range = $from.blockRange($to);
    const target = range ? liftTarget(range) : null;
    if (!range || target == null) return;
    view.dispatch(view.state.tr.lift(range, target));
  }
}

/** Turns the selection's block into another kind, as the selection bar's "Turn into" menu does. */
export function turnInto(editor: Editor, view: () => EditorView, kind: BlockKind): void {
  const commands = <T>(key: CmdKey<T>, payload?: T) =>
    editor.action((ctx) => ctx.get(commandsCtx).call(key, payload));
  // Lists and quotes wrap text, so start from a plain paragraph; a bullet only gets its box.
  if (!(kind === 'todo' && blockKind(view().state) === 'bullet')) {
    commands(turnIntoTextCommand.key);
    unwrapAt(view());
  }
  if (kind === 'text') {
    // Already plain.
  } else if (kind === 'h1' || kind === 'h2' || kind === 'h3')
    commands(wrapInHeadingCommand.key, Number(kind.slice(1)));
  else if (kind === 'bullet') commands(wrapInBulletListCommand.key);
  else if (kind === 'todo') {
    if (blockKind(view().state) !== 'bullet') commands(wrapInBulletListCommand.key);
    const current = view();
    const { $from } = current.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'list_item') {
        current.dispatch(
          current.state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            checked: false,
          }),
        );
        break;
      }
    }
  } else if (kind === 'number') commands(wrapInOrderedListCommand.key);
  else if (kind === 'quote') commands(wrapInBlockquoteCommand.key);
  else if (kind === 'code') commands(createCodeBlockCommand.key);
  view().focus();
}
