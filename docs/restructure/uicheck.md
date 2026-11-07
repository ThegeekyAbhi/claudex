# UI check restructure

The 1,941-line script is now a 104-line entry point plus a typed context, fixture factories,
and 26 sequential sections under `scripts/ui-check/`. Keeping these beside the entry point
makes their role as one stateful browser script explicit; they are not independent UI tests.
The runner retains preview/browser startup, screenshot directory creation, failure capture,
error reporting, cleanup, and the exact final success line.

This separates lifecycle, shared browser helpers, fixtures, and individual feature checks
(SRP). Sections receive their dependencies through `UiCheckContext` rather than module globals
(explicit dependency injection). The runner's ordered array preserves the original sequence;
each section comments on the state it consumes. Small areas remain below 100 lines rather than
combining unrelated checks merely to reach a file-size target.

## Module map

Runtime paths below are relative to `scripts/`; the test path is relative to the repository root.

| File | Responsibility |
| --- | --- |
| `ui-check.ts` | Start preview and Chromium, prepare context, execute ordered sections, summarize and clean up |
| `ui-check/context.ts` | Page preparation, error collection, live CSP flag accessor, shared locators and helpers |
| `ui-check/fixtures.ts` | Fresh model catalog, agent profiles and patch fixture |
| `ui-check/snapshot.ts` | Fresh initial session snapshot retaining the catalog/profile references |
| `ui-check/types.ts` | Re-export the existing Session type through the entry point |
| `tests/unit/scripts/ui-check/context.test.ts` | Four focused tests for the extracted setup/context seam |
| `ui-check/sections/models.ts` | Frame, initial agent/model menus, effort, first-message acknowledgement |
| `ui-check/sections/worktree.ts` | Worktree opt-in, initial mentions, duplicate-start protection |
| `ui-check/sections/thinking.ts` | Supported thinking toggle states |
| `ui-check/sections/conversation.ts` | Thinking, tool summaries, diffs and approvals |
| `ui-check/sections/questions.ts` | Question keyboard navigation, answers and decline |
| `ui-check/sections/usage.ts` | CLI usage, inspector and dismissed nudge |
| `ui-check/sections/child-threads.ts` | Child cards, agent mentions, delegation and model change |
| `ui-check/sections/terminal-drafts.ts` | Terminal ownership, per-thread drafts and worker composer |
| `ui-check/sections/changes.ts` | Checkout changes panel and icon tooltip |
| `ui-check/sections/new-chat-modes.ts` | New-chat context placement and mode selection |
| `ui-check/sections/skills.ts` | Skill menus, chips, availability and panel |
| `ui-check/sections/plan.ts` | Plan Markdown, implementation choices and feedback |
| `ui-check/sections/markdown.ts` | Mermaid rendering and theme updates |
| `ui-check/sections/images.ts` | Image viewer, narrow viewport and generation states |
| `ui-check/sections/context-menu.ts` | @/# categories, placement and context submission |
| `ui-check/sections/attachments.ts` | Image paste, thumbnail/viewer, submission and unavailable state |
| `ui-check/sections/mascot.ts` | Activity states, animation frames and reduced motion |
| `ui-check/sections/layout.ts` | Sidebar widths and four viewport sizes |
| `ui-check/sections/appearance.ts` | Editor, Cursor, light and contrast appearance |
| `ui-check/sections/mode-guides.ts` | Mode colours, guides, thread thinking and prose implementation |
| `ui-check/sections/thread-filters.ts` | Earlier children, search and running filter |
| `ui-check/sections/tabs.ts` | Draft tabs, signals, closing and in-flight snapshots |
| `ui-check/sections/visuals.ts` | Sandboxed visuals, network blocking and expected CSP errors |
| `ui-check/sections/continue-agent.ts` | Draft/context transfer and linked-thread resumption |
| `ui-check/sections/profiles.ts` | Host profiles, unavailable CLI, rename/add and mentions |
| `ui-check/sections/overview.ts` | Light-theme and overview screenshots, final browser-error assertion |

## Deliberately unchanged

- No source, dependencies, package scripts, lockfile, provider behavior or persisted formats changed.
- The exact `import type { Session } from '../src/core/model'` stays in the entry point for the
  other worker's path rewrite. `types.ts` forwards its type-only export, so section imports do
  not execute the runner or spawn a preview process.
- All fixtures, assertions, selectors, waits, polling, timeouts, screenshots, viewport dimensions
  and the final summary string remain intact. Pure locator/helper construction moves into
  context creation; it adds no browser interaction, wait or retry.
- CSP suppression remains a mutable accessor shared with the original console listener; it
  suppresses expected CSP console errors only. Page errors are always collected.
- Browser startup and screenshot-directory creation remain outside the original try/catch;
  browser-close and preview-kill order remain unchanged.

## Existing risks noticed, not fixed

Startup failure after preview launch but before entering the try/finally can leave preview
cleanup undone. A failure while taking the catch-block screenshot can mask the original error.
Both existed in the original runner and were retained to avoid changing failure behavior.
The script remains intentionally stateful: sections cannot be reordered or run independently.

## Verification

- `pnpm check`: **passed**, exit 0; lint, typecheck, **240 tests passed, 0 failed**, and build.
- `node --import tsx --test tests/unit/scripts/ui-check/context.test.ts`: **4 passed, 0 failed**. These
  focused tests now live in `tests/unit/scripts/ui-check/` and run with the recursive
  `tests/**/*.test.ts` package glob (see [tests.md](tests.md)). They check the live CSP flag, unconditional page errors,
  snapshot mutation/title waits, fixture isolation, outbound type forwarding and setup order.
- `pnpm test:ui`: attempted; **blocked by the sandbox**, exit 1. Preview could not bind
  `127.0.0.1:4173` (`listen EPERM: operation not permitted`). Chromium checks did not run and
  the final success line was not printed. The orchestrator must run this outside that restriction.
- Assertion text counts before → after, across the runner and runtime modules:
  **`assert.` 164 → 164; `expect(` 0 → 0**. The added seam tests use named Node assertion
  imports and are separate from the retained browser assertions.
- A TypeScript AST comparison against a pre-edit copy confirmed **164 identical assertions in
  identical order**, **730 identical ordered section statements** after excluding extracted
  helper/fixture declarations and normalizing the CSP accessor reference, and **593 identical
  browser-operation call trees** as a multiset. All **1,663 original literal occurrences** were
  retained, including selector strings/regexes, screenshot paths and numeric dimensions.
- Formatting uses the project's Biome configuration. No smoke tests or live provider calls ran.
