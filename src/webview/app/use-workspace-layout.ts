import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutStorage, PanelImperativeHandle } from 'react-resizable-panels';
import type { ViewState } from './bridge';

/** Below this width the workspace is one column, and the side panes open as overlays. */
export const WIDE_QUERY = '(min-width: 901px)';
const MAX_SAVED = 16;
const MAX_LENGTH = 2000;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Saved state comes back from an older build, or was edited; keep only plain strings. */
export function cleanSavedLayouts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, item]) => typeof item === 'string' && item.length <= MAX_LENGTH && key.length <= 200,
  ) as [string, string][];
  return Object.fromEntries(entries.slice(-MAX_SAVED));
}

/**
 * Pane sizes for the wide layout. They are saved with the rest of the view state, because
 * browser storage isn't reliably kept for VS Code webviews.
 */
export function useWorkspaceLayout(saved: ViewState | undefined) {
  const wide = useMediaQuery(WIDE_QUERY);
  const [layouts, setLayouts] = useState(() => cleanSavedLayouts(saved?.layouts));
  const current = useRef(layouts);
  current.current = layouts;
  const storage = useMemo<LayoutStorage>(
    () => ({
      getItem: (key) => current.current[key] ?? null,
      setItem: (key, value) => {
        if (current.current[key] === value) return;
        setLayouts((all) => cleanSavedLayouts({ ...all, [key]: value }));
      },
    }),
    [],
  );
  const threadsPanel = useRef<PanelImperativeHandle | null>(null);
  /** Whether the list shows as folded right now. */
  const [threadsCollapsed, setThreadsCollapsed] = useState(false);
  /** Whether you folded it. Kept across reloads and across panes opening and closing. */
  const [threadsFolded, setThreadsFolded] = useState(() => saved?.threadsFolded === true);
  const folded = useRef(threadsFolded);
  folded.current = threadsFolded;
  /** While panes are being sized by the app rather than by you, sizes don't change your choice. */
  const arranging = useRef(true);
  const setFolded = (value: boolean) => {
    folded.current = value;
    setThreadsFolded(value);
  };
  return {
    wide,
    layouts,
    storage,
    threads: {
      ref: threadsPanel,
      collapsed: threadsCollapsed,
      folded: threadsFolded,
      onResize(inPixels: number) {
        setThreadsCollapsed(inPixels < 1);
        if (!arranging.current) setFolded(inPixels < 1);
      },
      /**
       * The panes are about to change, as when the window crosses into the wide layout. Until
       * they're arranged, the sizes they report on mounting aren't your choice.
       */
      hold() {
        arranging.current = true;
      },
      /** Sizing done by the app, after which the list is folded again if you folded it. */
      arrange(apply: () => void) {
        arranging.current = true;
        try {
          apply();
          if (folded.current) threadsPanel.current?.collapse();
        } finally {
          requestAnimationFrame(() => {
            arranging.current = false;
          });
        }
      },
      toggle() {
        const panel = threadsPanel.current;
        if (!panel) return;
        const fold = !panel.isCollapsed();
        setFolded(fold);
        if (fold) panel.collapse();
        else panel.expand();
      },
      /**
       * Shows the thread list and puts the cursor in its search: the overlay when narrow, the
       * unfolded column when wide. A folded list can't take focus until it has opened.
       */
      reveal(openOverlay: () => void) {
        if (!wide) openOverlay();
        else if (threadsPanel.current?.isCollapsed()) {
          setFolded(false);
          threadsPanel.current.expand();
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => document.getElementById('thread-search')?.focus()),
        );
      },
    },
  };
}
