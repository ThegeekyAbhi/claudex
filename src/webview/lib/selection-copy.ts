import { type HostMessage, send } from '../app/bridge';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || Boolean(target.closest('input, textarea')))
  );
}

/** Route explicit copy gestures through the host clipboard, as message copy buttons do. */
export function installSelectionCopy(reportError: (text: string) => void): () => void {
  let pending: string | undefined;
  function copySelection(event: KeyboardEvent | ClipboardEvent): void {
    if (event.defaultPrevented || isEditable(event.target)) return;
    const selection = window.getSelection();
    if (
      !selection ||
      isEditable(selection.anchorNode?.parentElement ?? null) ||
      isEditable(selection.focusNode?.parentElement ?? null)
    )
      return;
    const text = selection.toString();
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    if (event instanceof ClipboardEvent) event.clipboardData?.setData('text/plain', text);
    pending = crypto.randomUUID();
    send({ type: 'copy', text, requestId: pending });
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'c'
    ) {
      copySelection(event);
      // Keep native input copying inside the webview rather than forwarding to editor commands.
      event.stopPropagation();
    }
  }
  function onResult(event: MessageEvent<HostMessage>): void {
    const message = event.data;
    if (message.type !== 'copyResult' || message.requestId !== pending) return;
    pending = undefined;
    if (!message.ok) reportError('Could not copy selected text. Try again.');
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('copy', copySelection);
  window.addEventListener('message', onResult);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('copy', copySelection);
    window.removeEventListener('message', onResult);
  };
}
