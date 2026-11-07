> Paths in these historical notes were later renamed; see [renames.md](renames.md).

# Controller restructure

## Changes and design

Reduced `src/host/controller.ts` from 1,535 to 467 lines. It remains the composition root and retains the same constructor, `initialize`, `open`, `compose`, and `dispose` API. It still owns surfaces, selection persistence, draft delivery, document watchers, status updates, and snapshot publishing.

Moved feature logic into cohesive handler classes. Each receives an explicit context interface containing its session operations, shared maps, surface operations, and callbacks. Session and surface dependencies use `Pick` or `Iterable` where possible. This separates responsibilities (SRP) and makes dependencies explicit (DIP), without adding another framework or changing provider execution.

The router parses raw messages with the existing `actionSchema` and dispatches through typed handler maps. Parsing remains synchronous, inside the controller's existing receive/error boundary. Surface and personal settings actions run first, profile actions run next, and workspace actions pass through the existing trust check after the asynchronous profile-dispatch boundary. The controller still activates the originating surface before validation, posts the same error text, and logs it afterward.

## Module map

| File | Responsibility |
| --- | --- |
| `src/host/controller.ts` | Composition, VS Code lifecycle, surfaces, selection, publishing, document watchers, draft delivery, personal settings |
| `src/host/action-groups.ts` | Literal action groups, exhaustive/disjoint type assertions, exact feature handler types |
| `src/host/router.ts` | Existing schema validation, typed dispatch, profile ordering, workspace trust gate |
| `src/host/handlers/catalog.ts` | Agent discovery, model and skill catalogs, refresh caching/versioning, model/thinking checks, skill validation/toggling |
| `src/host/handlers/profiles.ts` | Profile dialogs/settings, legacy profile conversion, native CLI sign-in, profile folders |
| `src/host/handlers/threads.ts` | Attachment resolution for sends, workspace selection, thread creation/delegation, sending, renaming/deletion, worktrees |
| `src/host/handlers/thread-control.ts` | Interrupt, approval, pin, and mode handlers with a small fakeable context and no runtime VS Code dependency |
| `src/host/handlers/plans.ts` | Saving dirty plan edits, building, continuing planning, viewing and saving plans |
| `src/host/handlers/documents.ts` | Document creation/opening, handoff, links, changes, diffs, copying |
| `src/host/handlers/attachments.ts` | Context preview/search, image picking/attachment/opening |
| `src/host/handlers/terminal.ts` | Native terminal handoff/return, CLI history recovery, Auto resumption |
| `tests/integration/extension/controller.test.ts` | Builds the real handler maps and compares their registered keys with the schema discriminants and declared groups |
| `tests/fixtures/host-route-fixture.ts` | Complete fake route maps whose unexpected handlers fail the test |
| `tests/unit/extension/router.test.ts` | Six router tests covering dispatch, schema errors, trust exceptions, profile awaiting, asynchronous ordering, trust rejection |
| `tests/unit/extension/handlers/thread-control.test.ts` | Four fake-context tests covering pin notifications, approval routing/answers, native terminal interruption rejection, interrupt/mode forwarding |

## Deliberately unchanged

- Provider adapters, harness, core/schema definitions, webview, and `src/host/worktrees.ts`.
- Storage and settings formats, command/view identifiers, protocol strings, local/native session IDs, notification/error text, and provider permission handling.
- Existing awaits and side-effect ordering within moved feature bodies; fire-and-forget provider sends/catalog refreshes remain fire-and-forget.
- Existing tests and assertions, dependencies, `package.json`, and `pnpm-lock.yaml`.
- Shared terminal/diff/document maps remain controller-owned so lifecycle listeners and handlers observe the same objects. Profile handlers read current agent discovery through a getter because discovery replaces its result object.
- No smoke or UI tests were run. No commits or branches were created.

## Suspected bugs and risks left alone

- Deleting an idle thread while its native terminal remains open appears able to leave a terminal-map entry behind. Closing that terminal later calls `returnFromTerminal`, whose initial `sessions.get` can reject before its history-read catch. This pre-existing path was not changed.
- The existing streaming startup timing test can be sensitive to load: the first full check reported 54.3 ms against its unchanged 50 ms limit. Both subsequent full checks passed. No assertion was relaxed.
- `pnpm check` does not run `tests/host/host-suite.ts` in this checkout. That suite requires a separate VS Code launch. Its bundle built with `node scripts/build-host-test.mjs`, but an isolated host launch was blocked by macOS: `NSOSStatusErrorDomain Code=-10826`, `kLSNoLaunchPermissionErr`. No host-suite success marker was produced, so real extension-host activation remains unverified here.

## Verification

- Compared all 34 moved helper method bodies against the original using TypeScript syntax tokens, normalizing dependency receivers and formatting-only trailing commas: all matched.
- Compared all 43 moved action cases against the original, additionally replacing switch exits with handler returns: all matched.
- Added 11 focused tests. Existing assertions remain intact; router and handler fixtures now provide complete maps to satisfy the stronger types.
- Ran `pnpm format` and `git diff --check`.
- Final `pnpm check`: passed (exit 0). Lint, TypeScript, tests, and build succeeded. **201 tests, 201 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo.**

## Review round 2: complete and disjoint registration

Replaced the public `ActionRoutes` groups' `Partial<ActionHandlers>` types with complete handler maps derived from the `as const` lists in `action-groups.ts`. Each feature's `handlers()` return type and the controller's surface-handler return type now require every key declared for that feature. Optional `never` properties forbid keys belonging to another feature, including properties introduced through object spreads. The workspace route type combines all workspace feature groups.

Type-level assertions reject missing schema actions and overlapping feature groups. The lists are centralized so reviewers can see the full partition together. The production modules import these declarations only as types: runtime dispatch, validation, error handling, routing order, trust checks, and handler bodies are unchanged.

The new runtime registry test uses the existing esbuild dependency with a stubbed VS Code module to construct the real feature maps and the controller's surface map without constructing a controller or invoking any action. It compares the complete registered key list with `actionSchema.options` discriminant values, rejects duplicates, and checks every feature against its declared list. It makes no provider calls or workspace changes.

Adjusted the existing test fixtures to supply complete maps; unexpected default handlers fail explicitly, and every previous assertion is retained. Verification also included in-memory TypeScript compiler probes: removing an action, declaring an action in two groups, and spreading a foreign handler into a feature all produced compiler errors. The probes did not modify source files. No new dependencies, bug fixes, UI/smoke runs, or commits were introduced.
