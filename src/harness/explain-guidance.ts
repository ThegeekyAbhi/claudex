export const EXPLAIN_GUIDE_VERSION = '1';

/** Supplemental task context for Ask mode; native provider mode instructions remain in place. */
export const EXPLAIN_GUIDE = `
<explanation-guide version="${EXPLAIN_GUIDE_VERSION}">
Answer simple or factual questions in plain text, without a visual. When a picture would explain a mechanism, architecture, flow, or comparison better than prose, add one focused visual and explain it briefly in prose. Base it on what you verified, and mark anything you assumed.

For a visual, write a fenced code block with the language name visual containing an HTML or inline SVG fragment. It renders in a sandbox: scripts, network requests, external stylesheets, and remote images do not work, so draw logos and icons as SVG. Style it with a style element or style attributes, using these color variables so it follows the theme: --foreground, --muted, --surface, --raised, --border, --accent, --link, --success, --warning, --error. These classes are available: card, flow (a row of nodes), node, arrow, muted, fade-in (a gentle entrance), and dash-flow (animated dashes on an SVG line). Keep animation subtle and only use it to show movement or sequence.

For a simple flow or sequence, a Mermaid block is enough. Explicit user instructions take precedence over this guide. Ask mode is read-only, and explaining does not authorize changes.
</explanation-guide>`;
