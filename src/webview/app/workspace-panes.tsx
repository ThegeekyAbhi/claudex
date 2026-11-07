import { type ReactNode, useEffect } from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
} from 'react-resizable-panels';
import type { useWorkspaceLayout } from './use-workspace-layout';

const SIDE_DEFAULT: Record<string, string> = { changes: '42%', docs: '280px' };
const THREADS_DEFAULT = '232px';
const PANE = 'flex min-h-0 min-w-0 overflow-hidden [&>*]:flex-1 [&>*]:min-w-0';
/** Zero-width in the flow, so each pane keeps its own border; the hit area is the library's. */
const HANDLE =
  'relative z-10 w-0 outline-none after:absolute after:inset-y-0 after:-left-px after:w-[3px] after:transition-colors after:duration-150 data-[separator=hover]:after:bg-[var(--focus)] data-[separator=active]:after:bg-[var(--focus)] data-[separator=focus]:after:bg-[var(--focus)] motion-reduce:after:transition-none';

/**
 * Main, the optional changes or documents pane, and the thread list, each resizable when wide.
 * Narrow, the side panes open as overlays. Main keeps one place in the tree either way, so
 * crossing the breakpoint never remounts it and loses what you were typing.
 */
export function WorkspacePanes({
  className,
  layout,
  main,
  side,
  sideKind,
  threads,
}: {
  className: string;
  layout: ReturnType<typeof useWorkspaceLayout>;
  main: ReactNode;
  side: ReactNode;
  sideKind: string | null;
  threads: ReactNode;
}) {
  const { wide } = layout;
  // Each pane gets its own id, so changes and documents remember their own widths.
  const sideId = wide && side && sideKind ? `side-${sideKind}` : undefined;
  const panelIds = ['main', ...(sideId ? [sideId] : []), ...(wide ? ['threads'] : [])];
  const saved = useDefaultLayout({
    id: 'workspace',
    panelIds,
    storage: layout.storage,
    onlySaveAfterUserInteractions: true,
  });
  const group = useGroupRef();
  const sidePanel = usePanelRef();
  const shape = panelIds.join(',');
  // A pane that joins an existing group ignores its default size, so whenever the set of panes
  // changes, restore what was saved for this set, or each pane's own default.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply only when the set of panes changes
  useEffect(() => {
    if (!wide) return;
    // The group registers a new pane during its own effects; size it on the next frame.
    const frame = requestAnimationFrame(() => {
      try {
        if (saved.defaultLayout) group.current?.setLayout(saved.defaultLayout);
        else {
          if (sideKind && sideId) sidePanel.current?.resize(SIDE_DEFAULT[sideKind] ?? '280px');
          layout.threads.ref.current?.resize(THREADS_DEFAULT);
        }
      } catch {
        // A pane that is already gone keeps the library's own sizing.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [shape]);
  return (
    <div className={className}>
      <Group
        groupRef={group}
        orientation="horizontal"
        className="h-full"
        defaultLayout={saved.defaultLayout}
        onLayoutChanged={saved.onLayoutChanged}
        resizeTargetMinimumSize={{ fine: 8, coarse: 20 }}
        disabled={!wide}
      >
        <Panel id="main" minSize={wide ? 360 : 0} className={PANE}>
          {main}
        </Panel>
        {sideId ? (
          <>
            <Separator id="side-handle" className={HANDLE} aria-label="Resize side panel" />
            <Panel
              id={sideId}
              panelRef={sidePanel}
              className={PANE}
              {...(sideKind === 'changes'
                ? { defaultSize: SIDE_DEFAULT.changes, minSize: 320, maxSize: '65%' }
                : {
                    defaultSize: SIDE_DEFAULT.docs,
                    minSize: 220,
                    maxSize: '50%',
                    groupResizeBehavior: 'preserve-pixel-size' as const,
                  })}
            >
              {side}
            </Panel>
          </>
        ) : null}
        {wide ? (
          <>
            <Separator id="threads-handle" className={HANDLE} aria-label="Resize thread list" />
            <Panel
              id="threads"
              panelRef={layout.threads.ref}
              className={PANE}
              defaultSize={THREADS_DEFAULT}
              minSize={180}
              maxSize={420}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => layout.threads.setCollapsed(size.inPixels < 1)}
              // Folded away, its buttons must not stay reachable by Tab.
              inert={layout.threads.collapsed}
            >
              {threads}
            </Panel>
          </>
        ) : null}
      </Group>
      {wide ? null : (
        <>
          {side}
          {threads}
        </>
      )}
    </div>
  );
}
