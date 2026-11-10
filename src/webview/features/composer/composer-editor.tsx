import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '../../../shared/model';
import { ReferenceIcon } from '../../components/reference-icon';
import { type ComposerEditorHandle, editorSelection, editorText, selectEditor } from './editor-dom';
import { hasImageReference, type PathAttachment, referenceParts } from './references';

interface Props {
  ref: Ref<ComposerEditorHandle>;
  value: string;
  attachments: Attachment[];
  draftKey: string;
  placeholder: string;
  onChange: (value: string) => void;
  onAttachments: (attachments: Attachment[]) => void;
  onSelect: (editor: ComposerEditorHandle) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onImages: (files: File[]) => void;
}
interface Revision {
  text: string;
  attachments: Attachment[];
  caret: number;
}
export function ComposerEditor(props: Props): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [icons, setIcons] = useState<{ target: HTMLElement; attachment: PathAttachment }[]>([]);
  const composing = useRef(false);
  const selection = useRef({ start: 0, end: 0 });
  const pending = useRef<number | undefined>(undefined);
  const history = useRef<{ key: string; items: Revision[]; index: number }>({
    key: props.draftKey,
    items: [],
    index: -1,
  });
  const restoring = useRef(false);
  const rendered = useRef('');
  const handle: ComposerEditorHandle = {
    get element() {
      return root.current;
    },
    get value() {
      return root.current ? editorText(root.current) : props.value;
    },
    get selectionStart() {
      return root.current && document.activeElement === root.current
        ? editorSelection(root.current).start
        : selection.current.start;
    },
    get selectionEnd() {
      return root.current && document.activeElement === root.current
        ? editorSelection(root.current).end
        : selection.current.end;
    },
    focus() {
      root.current?.focus();
      if (root.current) selectEditor(root.current, selection.current.start, selection.current.end);
    },
    setSelectionRange(start, end) {
      selection.current = { start, end };
      if (root.current) selectEditor(root.current, start, end);
    },
  };
  useImperativeHandle(props.ref, () => handle);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || composing.current) return;
    const focused = document.activeElement === element;
    const currentSelection = focused ? editorSelection(element) : selection.current;
    const caret = pending.current ?? currentSelection.start;
    const end = pending.current ?? currentSelection.end;
    const parts = referenceParts(props.value, props.attachments);
    const signature = JSON.stringify([props.draftKey, parts]);
    if (rendered.current !== signature || editorText(element) !== props.value) {
      const fragment = document.createDocumentFragment();
      const nextIcons: { target: HTMLElement; attachment: PathAttachment }[] = [];
      for (const part of parts) {
        if (!part.attachment) {
          fragment.append(document.createTextNode(part.text));
          continue;
        }
        const chip = document.createElement('span');
        chip.contentEditable = 'false';
        chip.className = 'inline-reference';
        chip.dataset.token = part.text;
        chip.title = part.attachment.path;
        const icon = document.createElement('span');
        icon.className = 'reference-icon-slot';
        nextIcons.push({ target: icon, attachment: part.attachment });
        const label = document.createElement('span');
        label.className = 'reference-label';
        label.textContent = part.label ?? part.text;
        chip.append(icon, label);
        fragment.append(chip);
      }
      // A final break gives a trailing newline a visible line for the caret.
      const end = document.createElement('br');
      end.dataset.editorEnd = 'true';
      fragment.append(end);
      element.replaceChildren(fragment);
      setIcons(nextIcons);
      rendered.current = signature;
    }
    selection.current = { start: caret, end };
    if (focused) selectEditor(element, caret, end);
    pending.current = undefined;
    const state = history.current;
    if (state.key !== props.draftKey) {
      state.key = props.draftKey;
      state.items = [];
      state.index = -1;
    }
    if (!restoring.current) {
      const previous = state.items[state.index];
      if (
        !previous ||
        previous.text !== props.value ||
        JSON.stringify(previous.attachments) !== JSON.stringify(props.attachments)
      ) {
        state.items.splice(state.index + 1);
        state.items.push({ text: props.value, attachments: props.attachments, caret });
        if (state.items.length > 100) state.items.shift();
        state.index = state.items.length - 1;
      }
    }
    restoring.current = false;
  }, [props.value, props.attachments, props.draftKey]);

  function change(text: string, caret: number): void {
    const previousReferences = new Set(
      referenceParts(props.value, props.attachments).map((part) => part.attachment),
    );
    const nextReferences = new Set(
      referenceParts(text, props.attachments).map((part) => part.attachment),
    );
    pending.current = caret;
    selection.current = { start: caret, end: caret };
    const kept = props.attachments.filter((item) => {
      if (item.kind === 'image')
        return !hasImageReference(props.value, item) || hasImageReference(text, item);
      if (item.kind !== 'file' && item.kind !== 'folder') return true;
      return !previousReferences.has(item) || nextReferences.has(item);
    });
    if (kept.length !== props.attachments.length) props.onAttachments(kept);
    props.onChange(text);
  }
  function replaceSelection(text: string) {
    const { start, end } = root.current ? editorSelection(root.current) : { start: 0, end: 0 };
    change(`${props.value.slice(0, start)}${text}${props.value.slice(end)}`, start + text.length);
  }
  function undo(redo: boolean) {
    const state = history.current;
    const index = state.index + (redo ? 1 : -1);
    const revision = state.items[index];
    if (!revision) return;
    state.index = index;
    restoring.current = true;
    pending.current = revision.caret;
    props.onAttachments(revision.attachments);
    props.onChange(revision.text);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      undo(event.shiftKey || key === 'y');
      return;
    }
    props.onKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceSelection('\n');
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && root.current) {
      const { start, end } = editorSelection(root.current);
      let offset = 0;
      for (const part of referenceParts(props.value, props.attachments)) {
        const finish = offset + part.text.length;
        if (
          start === end &&
          part.attachment &&
          ((event.key === 'Backspace' && start === finish) ||
            (event.key === 'Delete' && start === offset))
        ) {
          event.preventDefault();
          change(props.value.slice(0, offset) + props.value.slice(finish), offset);
          return;
        }
        offset = finish;
      }
    }
  }
  function readSelection() {
    if (root.current) selection.current = editorSelection(root.current);
    props.onSelect(handle);
  }
  function copy(event: ClipboardEvent<HTMLDivElement>, cut: boolean) {
    if (!root.current) return;
    const { start, end } = editorSelection(root.current);
    if (start === end) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', props.value.slice(start, end));
    if (cut) replaceSelection('');
  }
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: inline non-editable references require a rich textbox */}
      <div
        ref={root}
        className="composer-input"
        role="textbox"
        tabIndex={0}
        aria-label="Message your agent"
        aria-multiline="true"
        data-value={props.value}
        data-placeholder={props.placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={() => {
          if (composing.current || !root.current) return;
          change(editorText(root.current), editorSelection(root.current).start);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (root.current) change(editorText(root.current), editorSelection(root.current).start);
        }}
        onBeforeInput={(event) => {
          const type = (event.nativeEvent as InputEvent).inputType;
          if (type === 'insertParagraph' || type === 'insertLineBreak') {
            event.preventDefault();
            replaceSelection('\n');
          }
          if (type === 'historyUndo' || type === 'historyRedo') {
            event.preventDefault();
            undo(type === 'historyRedo');
          }
        }}
        onSelect={readSelection}
        onKeyUp={readSelection}
        onMouseUp={readSelection}
        onBlur={() => {
          if (root.current) selection.current = editorSelection(root.current);
          props.onBlur();
        }}
        onKeyDown={onKeyDown}
        onCopy={(event) => copy(event, false)}
        onCut={(event) => copy(event, true)}
        onPaste={(event) => {
          event.preventDefault();
          const files = Array.from(event.clipboardData.files).filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length) props.onImages(files);
          else replaceSelection(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
        }}
        onDrop={(event) => event.preventDefault()}
      />
      {icons.map(({ target, attachment }, index) =>
        createPortal(
          <ReferenceIcon kind={attachment.kind} path={attachment.path} />,
          target,
          String(index),
        ),
      )}
    </>
  );
}
