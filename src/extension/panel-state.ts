/**
 * The thread a restored editor tab was showing. VS Code hands back whatever the webview last
 * saved, so it is untrusted: only a string naming a thread that still exists is accepted.
 */
export function restoredThreadId(
  state: unknown,
  exists: (id: string) => boolean,
): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const id = (state as { selectedId?: unknown }).selectedId;
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return undefined;
  return exists(id) ? id : undefined;
}
