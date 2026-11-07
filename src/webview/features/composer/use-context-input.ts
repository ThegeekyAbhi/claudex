import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type AgentKind, type Attachment, withMention } from '../../../shared/model';
import { send } from '../../app/bridge';
import { caretRect, type MenuAnchor, placeMenu } from '../../lib/caret';
import { requestContext, type Trigger, triggerAt } from '../attachments/context-menu';
import type { ComposerProps } from './types';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
export function useContextInput({
  draft,
  attachments,
  draftKey,
  focusKey,
  onDraft,
  onAttachments,
  onError,
  agent,
}: Pick<
  ComposerProps,
  'draft' | 'attachments' | 'draftKey' | 'focusKey' | 'onDraft' | 'onAttachments' | 'onError'
> & { agent: AgentKind }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<Trigger>();
  /** Escape hides the menu until the text changes. */
  const [dismissed, setDismissed] = useState<number>();
  const menuKeys = useRef<((event: React.KeyboardEvent) => boolean) | null>(null);
  const menuFrame = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const requestId = useRef(0);
  const pendingCaret = useRef<number | undefined>(undefined);
  const menuOpen = Boolean(trigger) && dismissed !== trigger?.start;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusing follows a change of thread
  useEffect(() => {
    textarea.current?.focus();
  }, [focusKey]);
  const query = trigger?.query;
  const skillTrigger = trigger?.mark === '/';
  // Results are searched by the host, a moment after typing settles.
  useEffect(() => {
    if (query === undefined || !menuOpen || skillTrigger) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => requestContext(id, query), query ? 80 : 0);
    return () => clearTimeout(timer);
  }, [query, menuOpen, skillTrigger]);
  // Refreshed behind the menu, which shows what's already known straight away.
  useEffect(() => {
    if (skillTrigger && menuOpen) send({ type: 'refreshSkills', agent });
  }, [skillTrigger, menuOpen, agent]);
  // In the same commit as the text, so a key pressed right after a pick cannot land before it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: this follows the draft changing
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return;
    textarea.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = undefined;
  }, [draft]);
  // Follows the @ itself, so the menu stays put while you type what comes after it.
  const triggerStart = menuOpen ? trigger?.start : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed draft can rewrap the line
  useLayoutEffect(() => {
    const box = textarea.current;
    const area = menuFrame.current;
    if (triggerStart === undefined || !box || !area) {
      setAnchor(undefined);
      return;
    }
    const measure = () => {
      const width = window.innerWidth;
      setAnchor(
        placeMenu(
          caretRect(box, triggerStart),
          area.getBoundingClientRect(),
          { width, height: window.innerHeight },
          Math.min(360, width - 32),
        ),
      );
    };
    measure();
    window.addEventListener('resize', measure);
    box.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      box.removeEventListener('scroll', measure);
    };
  }, [triggerStart, draft]);
  function readTrigger(element: HTMLTextAreaElement) {
    setTrigger(triggerAt(element.value, element.selectionStart));
  }
  function removeToken() {
    if (!trigger) return draft;
    const next = `${draft.slice(0, trigger.start)}${draft.slice(trigger.end)}`;
    onDraft(next);
    setTrigger(undefined);
    pendingCaret.current = trigger.start;
    textarea.current?.focus();
    return next;
  }
  function attach(attachment: Attachment) {
    removeToken();
    const same = (item: Attachment) => JSON.stringify(item) === JSON.stringify(attachment);
    if (!attachments.some(same)) onAttachments([...attachments, attachment]);
  }
  function pickAgent(name: string) {
    if (!trigger) return;
    const next = withMention(draft, trigger.start, trigger.end, name);
    onDraft(next.text);
    setTrigger(undefined);
    pendingCaret.current = next.caret;
    textarea.current?.focus();
  }
  async function addFiles(files: File[]) {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        onError(`${file.name} is larger than the 10 MB limit.`);
        continue;
      }
      send({
        type: 'attachImage',
        draftKey,
        name: file.name || 'Pasted image.png',
        data: await readFile(file),
      });
    }
  }
  return {
    textarea,
    trigger,
    setTrigger,
    setDismissed,
    menuKeys,
    menuFrame,
    anchor,
    menuOpen,
    readTrigger,
    removeToken,
    attach,
    pickAgent,
    addFiles,
  };
}
