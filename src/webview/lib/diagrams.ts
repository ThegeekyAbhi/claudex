let sequence = 0;
let loaded: Promise<typeof import('mermaid')> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function colors() {
  const style = getComputedStyle(document.body);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const light =
    document.body.classList.contains('vscode-light') ||
    document.body.classList.contains('vscode-high-contrast-light');
  return {
    // The semantic tokens carry the chosen appearance. The Markdown preview only has VS Code's.
    background: token(
      '--canvas',
      token('--vscode-editor-background', light ? '#ffffff' : '#181818'),
    ),
    foreground: token('--foreground', token('--vscode-foreground', light ? '#222222' : '#dedede')),
    border: token(
      '--border-strong',
      token(
        '--vscode-contrastBorder',
        token('--vscode-panel-border', light ? '#606060' : '#aaaaaa'),
      ),
    ),
    surface: token('--raised', token('--vscode-input-background', light ? '#eeeeee' : '#303030')),
    font: `${token('--vscode-font-family', 'system-ui')}, system-ui, sans-serif`,
  };
}

/** Mermaid has global configuration, so configure and render each diagram serially. */
export function diagramSvg(source: string): Promise<string> {
  const render = queue
    .catch(() => undefined)
    .then(async () => {
      loaded ??= import('mermaid');
      const { default: mermaid } = await loaded;
      const theme = colors();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        look: 'classic',
        suppressErrorRendering: true,
        fontFamily: theme.font,
        fontSize: 13,
        flowchart: { curve: 'basis', padding: 12, nodeSpacing: 36, rankSpacing: 40 },
        // Flat, quiet shapes: no drop shadows, soft corners, hairline edges.
        themeCSS: [
          '.node rect, .node polygon, .node circle, .node path, .cluster rect { filter: none; stroke-width: 1px; }',
          '.node rect, .cluster rect { rx: 6px; ry: 6px; }',
          '.flowchart-link, .edgePath .path { stroke-width: 1.25px; }',
          `.edgeLabel, .edgeLabel p, .labelBkg { background-color: ${theme.background}; }`,
          `.edgeLabel rect { fill: ${theme.background}; opacity: 1; }`,
          '.edgeLabel p { padding: 0 4px; }',
          '.label, .nodeLabel, .edgeLabel { font-size: 13px; }',
          '* { filter: none; }',
        ].join('\n'),
        themeVariables: {
          background: theme.background,
          fontFamily: theme.font,
          primaryColor: theme.surface,
          primaryTextColor: theme.foreground,
          primaryBorderColor: theme.border,
          secondaryColor: theme.surface,
          tertiaryColor: theme.background,
          lineColor: theme.foreground,
          textColor: theme.foreground,
          mainBkg: theme.surface,
          nodeTextColor: theme.foreground,
          edgeLabelBackground: theme.background,
          actorBkg: theme.surface,
          actorTextColor: theme.foreground,
          actorBorder: theme.border,
          signalColor: theme.foreground,
          signalTextColor: theme.foreground,
        },
      });
      return (await mermaid.render(`workspace-diagram-${++sequence}`, source)).svg;
    });
  queue = render;
  return render;
}

export function subscribeDiagramTheme(changed: () => void): () => void {
  let previous = JSON.stringify(colors());
  const observer = new MutationObserver(() => {
    const next = JSON.stringify(colors());
    if (next !== previous) {
      previous = next;
      changed();
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-vscode-theme-id'],
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-appearance'],
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}
