> Paths in these historical notes were later renamed; see [renames.md](renames.md).

# Webview restructure

## Changes and design principles

Split the three large webview components by responsibility without changing their rendered
markup, event bodies, host actions, persisted state, or provider behavior.

- **App (SRP/DIP, revised after round 2):** layout and composition stay in `app.tsx`; the
  header and recent-thread list are presentation components. `useAppState` is now a 46-line
  composition hook returning nine concern objects, rather than a flat bag of state/setters.
  Each concern owns its state: drafts/attachments, compose choices/nudges, tabs/selection,
  thread visibility/scroll, changes panel, submission lifecycle, and transient workspace UI.
  `useHostMessages` owns only the snapshot/media state and bridge subscription; it dispatches
  through callbacks into those owners. The former `useHost` state bag was removed.
  `useSavedViewState` contains the only `api.getState()`/`api.setState()` call sites, and
  `savedViewState` projects domain state into the exact existing persisted shape. State is
  hydrated in its owning hook rather than duplicated in a persistence store. No reducer or
  state library was introduced.
- **Conversation (SRP/DIP):** the root owns scrolling, pagination, and row composition. Activity,
  tool, worker, message, and approval views each live beside it. Pure display decisions live in
  `view-model.ts`. The root supplies guide text to message/worker views as ordinary props so
  these new modules have no harness imports or circular runtime dependencies.
- **Composer (SRP):** layout remains in `composer.tsx`. Model/mode decisions and input behavior
  are separate hooks; controls and the caption are presentation components. Shared props and
  pure model lookup/effort retention have their own modules.

## Module map

All paths below are relative to `src/webview/`.

| File | Responsibility |
| --- | --- |
| `app/app.tsx` | Workspace layout and composition |
| `app/app-header.tsx` | Tabs and header actions |
| `app/recent-threads.tsx` | Existing recent-thread list |
| `app/state.ts` | Compose domain hooks, connect message callbacks, derive question/linked-thread references |
| `app/use-drafts.ts` | Draft text and attachment state; ordered acknowledgement updates |
| `app/use-compose-choice.ts` | Compose choice, nudges, mode memory, installed-agent fallback |
| `app/use-tabs.ts` | Selected thread, open/draft tabs, history visibility, closing/started-draft guards, reconciliation/navigation |
| `app/use-thread-view.ts` | Sidebar filter, seen timestamps, document visibility, scroll ref, child-thread map |
| `app/use-changes-panel.ts` | Panel selection, per-session change results, request/loading lifecycle |
| `app/use-turns.ts` | Submission/starting state, submit guards, continuation actions, acknowledgement/error lifecycle |
| `app/use-workspace-ui.ts` | Error/skills state, appearance effect, keyboard shortcut/focus effects |
| `app/use-host-messages.ts` | One bridge subscription, snapshot merging, image base, context results; callback dispatch to state owners |
| `app/host-messages.ts` | Pure host-message router preserving update ordering |
| `app/use-saved-view-state.ts` | Initial saved-state reference, single persistence writer, pagehide/latest-state handling |
| `app/saved-view-state.ts` | Pure projection into the unchanged persisted fields and key order |
| `app/bridge.ts` | Existing bridge; `ViewState` is now exported as a type without changing its shape |
| `features/conversation/conversation.tsx` | Transcript scrolling/pagination, plan placement, row composition; existing public exports |
| `features/conversation/view-model.ts` | Segmentation, worker lookup, keys, duration/verb/summary text, diff filtering |
| `features/conversation/message-row.tsx` | Message rows, sent prompts, guide disclosures |
| `features/conversation/tool-step.tsx` | Tool detail, legacy tool, reasoning rows |
| `features/conversation/step-state.tsx` | Chevron and explicit tool status indicators |
| `features/conversation/activity-group.tsx` | Group expansion, activity summary, persistent diff cards |
| `features/conversation/subagent-card.tsx` | Worker cards and child transcripts |
| `features/conversation/approval-form.tsx` | Existing approval eligibility, buttons, and host actions |
| `features/composer/composer.tsx` | Composer layout, textarea events, attachment rendering, submission controls |
| `features/composer/types.ts` | Unchanged composer prop contract |
| `features/composer/use-composer.ts` | Derived model/mode/thinking/skill state and selection actions |
| `features/composer/use-context-input.ts` | Focus/caret, triggers, menu positioning/search, attachment selection, image reads |
| `features/composer/model-options.ts` | Pure catalog lookup and effort retention |
| `features/composer/controls.tsx` | Mode, model, effort, thinking, and guide controls |
| `features/composer/caption.tsx` | Location selection and existing nudge actions |

New focused tests are in `tests/unit/webview/features/conversation/view-model.test.ts`,
`tests/unit/webview/features/composer/model-options.test.ts`, `tests/unit/webview/app/host-messages.test.ts`, and `tests/unit/webview/app/saved-view-state.test.ts`. No existing test assertions
were changed.

## Deliberately unchanged

- All native DOM elements, class names, aria attributes, visible strings, and textarea event
  bodies. Presentation components add no DOM wrappers (controls use a fragment).
- Bridge message types/payloads, snapshot merging, persisted view state fields, session IDs,
  tab replacement/closing guards, submit guards, and acknowledgement/error transitions.
- Composer focus, synchronous caret restoration, IME/Enter/Shift-Tab handling, autocomplete
  debounce and positioning, attachment identity checks, image size limit, and sequential reads.
- Conversation paging, scroll following/jump behavior, worker/approval status interpretation,
  guide disclosure contents, and approval eligibility/actions.
- `ApprovalForm` and `segment` remain exported from `conversation.tsx` for compatibility.
- The two `EXPLAIN_GUIDE` / `PLANNING_GUIDE` import lines in `conversation.tsx` are exactly as
  before, as requested for the other worker's import-only change. They are the existing
  cross-layer imports pending that merge. No new module imports harness, host, providers,
  Node APIs, or VS Code APIs.
- No dependency, package, lockfile, provider, host, or persisted-format changes. No commits,
  branches, smoke calls, UI suite runs, or other worktree edits.

## Suspected bugs and risks left alone

These are observations about existing behavior, not fixes in this refactor:

- Pasted-image processing awaits `readFile`, but its caller uses `void addFiles(files)` without
  catching read rejection. A FileReader failure may become an unhandled rejection.
- A `sent` acknowledgement clears that session's attachments unconditionally, while draft
  text is cleared only if it matches the acknowledged message. Attachments changed during an
  in-flight send may therefore be cleared.
- Server rendering and source comparison cannot establish browser focus, scroll, or pixel
  equivalence. The orchestrator's post-merge UI suite remains the browser verification step.
- The host subscription retains the latest callbacks through a ref so ordinary renders do
  not re-subscribe or send extra `ready` messages. Callback owners still use functional state
  updates and the same long-lived starting/closing/started-draft refs.
- Persistence deliberately does not run for scroll-only changes, matching the old dependency
  list. Pagehide writes the latest view state and the same mutable scroll object.

## Verification

- `pnpm format`: passed, scoped changes reviewed; no unrelated tracked files changed.
- `pnpm check`: **exit 0**. Lint, TypeScript, all tests, and production build passed.
  **207 tests; 207 passed; 0 failed; 0 cancelled; 0 skipped; 0 todo.** The known streaming
  timing test passed; no retry or assertion change was needed.
- Added nine focused tests for segmentation (including observed diffs and worker tools),
  worker lookup, segment keys/plan anchors, activity summaries, unsuccessful diff exclusion,
  status verbs, duration rounding, model resolution, and effort retention.
- Added eight app tests in round 2 for host-message routing/update order and persistence:
  snapshot merge → optional image base → submission reset → selection; acknowledged draft
  update → submission release; visible error → submission failure/reset → changes-loading
  reset; and exclusive dispatch for draft/attachment/context/changes messages. The failure
  callback retains starting-ref reset → started-draft-ref clear → submitted reset, and the
  draft callback retains text acknowledgement → attachment clearing.
- Persistence tests pin byte-identical JSON field names/order for a populated fixture,
  undefined-selection handling, exclusion of transient fields, reference identity, and mutable
  scroll visibility for pagehide. The projection order remains `selectedId`, `drafts`,
  `attachments`, `scroll`, `compose`, `dismissedNudges`, `threadView`, `tabs`, `activeDraft`,
  `seen`. Initialization defaults and the original persistence trigger fields are unchanged.
- Compared TypeScript AST inventories of all native JSX tags and attributes against untouched
  copies of the three original files: **141 elements matched**, including their event-handler
  expressions after normalizing domain-object access paths introduced in round 2. The original
  guide import lines were retained verbatim.
- An ephemeral local comparison bundled original and extracted implementations with the same
  dependencies and compared React server-rendered output: **18 cases matched byte for byte**.
  Cases covered the app's initial layout; empty/top/drafted/mentioned/busy/planning/attached/
  locked/thinking composers; and empty/message/streaming/worker/approval/transition/failed
  conversations, including both guide disclosures. This comparison was rerun after round 2.
  It ran without a browser or provider call.
- `git diff --check`: passed.
- `pnpm test:ui` and `pnpm smoke` were not run, as instructed.
