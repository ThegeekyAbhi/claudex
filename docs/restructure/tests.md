# Tests restructure

## Changes and design

Reorganized the flat test directory into source-shaped unit and integration trees
(SRP: location identifies the responsibility under test). Unit tests perform no real
filesystem, process, or network operations. Integration tests retain real temporary
files, Git, persistence, fake CLI streams/processes, and esbuild execution.

Split independent top-level groups in the old diff, streaming, webview-app, and
session-services files. Test bodies and their setup dependencies retain their original
statements; no production seam or abstraction was introduced. Existing route fakes
now live in `tests/fixtures/` (DIP: explicit fake dependencies remain separate).

Moved the four existing UI-context tests from the script directory into
`tests/unit/scripts/ui-check/context.test.ts`. Their Page objects are fakes: running
these tests launches no browser or server. Only the package `test` script changed,
to `node --import tsx --test "tests/**/*.test.ts"`. The quoted glob works on the
installed Node v24.15.0 and includes unit, integration, and architecture tests.
The separately launched VS Code suite remains outside that glob.

Updated the host builder entry to `tests/host/host-suite.ts` and documentation that
names moved tests. The boundary scanner's source root now resolves `../../src/`
relative to `tests/architecture/boundaries.test.ts`; its scanner and assertions are
unchanged.

## Module map

All test paths below are relative to `tests/`. Suffixes on session-manager and
adapter tests identify retained feature scenarios for the same source module.

| Test file | Source module / responsibility |
| --- | --- |
| `architecture/boundaries.test.ts` | Source dependency scan and scanner cases |
| `fixtures/host-route-fixture.ts` | Complete fake action routes shared by router and handler tests |
| `host/host-suite.ts` | VS Code activation, commands, and real webview host suite |
| `integration/application/sessions/session-manager.planning.test.ts` | `src/application/sessions/session-manager.ts`: planning, thinking, persistence |
| `integration/application/sessions/session-manager.preferences.test.ts` | `src/application/sessions/session-manager.ts`: preferences, guidance, persistence |
| `integration/application/sessions/session-manager.session-packet.test.ts` | `src/application/sessions/session-manager.ts`: cross-agent packet, attachments, persistence |
| `integration/application/sessions/session-manager.test.ts` | `src/application/sessions/session-manager.ts` |
| `integration/application/sessions/session-persistence.test.ts` | `src/application/sessions/session-persistence.ts` |
| `integration/application/sessions/turn-lifecycle.test.ts` | `src/application/sessions/turn-lifecycle.ts` |
| `integration/extension/agent-paths.test.ts` | `src/extension/agent-paths.ts` |
| `integration/extension/attachments.test.ts` | `src/extension/attachments.ts` |
| `integration/extension/changes.test.ts` | `src/extension/changes.ts` |
| `integration/extension/controller.test.ts` | `src/extension/controller.ts`: bundled real handler registration coverage |
| `integration/extension/documents.test.ts` | `src/extension/documents.ts` |
| `integration/extension/plans.test.ts` | `src/extension/plans.ts` |
| `integration/infrastructure/file-observer.test.ts` | `src/infrastructure/file-observer.ts` |
| `integration/infrastructure/git.test.ts` | `src/infrastructure/git.ts` |
| `integration/infrastructure/worktrees.test.ts` | `src/infrastructure/worktrees.ts` |
| `integration/providers/claude/adapter.modes.test.ts` | Claude adapter mode streams, Codex settings, and shared mode/nudge contracts |
| `integration/providers/claude/adapter.test.ts` | `src/providers/claude/adapter.ts` |
| `integration/providers/codex/adapter.test.ts` | `src/providers/codex/adapter.ts` |
| `integration/providers/process.test.ts` | `src/providers/process.ts` |
| `integration/providers/terminal.test.ts` | `src/providers/terminal.ts` |
| `unit/application/catalogs/skill-catalog.test.ts` | `src/application/catalogs/skill-catalog.ts`: parsing and related skill contracts |
| `unit/application/sessions/agent-factory.test.ts` | `src/application/sessions/agent-factory.ts` |
| `unit/application/sessions/session-approvals.test.ts` | `src/application/sessions/session-approvals.ts` |
| `unit/application/sessions/session-files.test.ts` | `src/application/sessions/session-files.ts` |
| `unit/application/sessions/session-persistence.test.ts` | `src/application/sessions/session-persistence.ts` |
| `unit/extension/handlers/thread-control.test.ts` | `src/extension/handlers/thread-control.ts` |
| `unit/extension/router.test.ts` | `src/extension/router.ts` |
| `unit/providers/registry.test.ts` | `src/providers/registry.ts` |
| `unit/providers/tool-format.test.ts` | `src/providers/tool-format.ts` |
| `unit/providers/usage.test.ts` | `src/providers/usage.ts` |
| `unit/scripts/ui-check/context.test.ts` | `scripts/ui-check/context.ts`: setup order, errors, snapshots, fixture isolation |
| `unit/shared/domain/diff.test.ts` | `src/shared/domain/diff.ts` |
| `unit/shared/model.test.ts` | `src/shared/model.ts`: public domain/protocol barrel contracts |
| `unit/shared/protocol/snapshot.test.ts` | `src/shared/protocol/snapshot.ts` |
| `unit/webview/app/host-messages.test.ts` | `src/webview/app/host-messages.ts` |
| `unit/webview/app/saved-view-state.test.ts` | `src/webview/app/saved-view-state.ts` |
| `unit/webview/features/composer/model-options.test.ts` | `src/webview/features/composer/model-options.ts` |
| `unit/webview/features/conversation/view-model.test.ts` | `src/webview/features/conversation/view-model.ts` |
| `unit/webview/features/mascot/activity.test.ts` | `src/webview/features/mascot/activity.ts` |
| `unit/webview/features/threads/tab-state.test.ts` | `src/webview/features/threads/tab-state.ts` |
| `unit/webview/features/threads/thread-filter.test.ts` | `src/webview/features/threads/thread-filter.ts` |
| `unit/webview/lib/caret.test.ts` | `src/webview/lib/caret.ts` |
| `unit/webview/lib/visual-document.test.ts` | `src/webview/lib/visual-document.ts` |

## Deliberately retained mixed coverage

- `shared/model.test.ts` tests the existing public barrel across several domain and
  protocol modules. It remains intact to preserve the barrel contract coverage.
- Session-manager planning, preferences, and session-packet scenarios share manager
  setup, event sinks, timing helpers, and persistence. They remain whole under that
  facade in integration rather than duplicating coupled fixtures across layers.
- `extension/plans.test.ts`, attachments, documents, worktrees, and Claude adapter
  tests retain nearby pure title/parser/schema/path assertions alongside their I/O
  scenarios. Their shared domain fixtures and end-to-end contracts make the closest
  covering module a useful home; all are conservatively integration tests.
- `providers/claude/adapter.modes.test.ts` intentionally retains cross-provider mode
  comparisons and nudge assertions around fake Claude query streams. Splitting the
  shared mode matrix would scatter a single behavioral contract.
- `application/catalogs/skill-catalog.test.ts` retains the small related search,
  invocation, attachment-resolution, and tool-description checks. All its inputs
  are in memory and the skill attachment branch does no filesystem work.
- `providers/usage.test.ts` retains its related event projection assertion beside
  pure usage parsing. No actual provider runs in either test tree.

Production source, dependencies, pnpm-lock.yaml, persisted formats, IDs, schemas,
provider behavior, and all existing assertions were left unchanged. No smoke,
UI-browser, or GUI host suite ran. No commits, branches, or pushes were made.

## Risks and Git details

No production bugs were fixed. The pre-existing send-latency assertion still uses a
50 ms wall-clock limit and may be sensitive to machine load; it remains unchanged
in integration/application/sessions/turn-lifecycle.test.ts. The boundary scanner
retains its existing regex limitations described in boundaries.md.

Normal `git mv` could not create the worktree index lock (Operation not permitted).
Every move was performed with `git mv` using a copy of the index under `/tmp`,
matching the previous restructure workflow. The real index is unchanged. The
orchestrator must stage both deleted and new paths to record the renames; the
new directories are intentionally untracked until that review/staging step.
The node_modules symlink was ignored.

## Verification

- pnpm **10.33.2**, Node **v24.15.0**.
- Baseline `pnpm test`: **240 passed**, 0 failed, cancelled, skipped, or todo.
- Final `pnpm check`: **exit 0**; lint, typecheck, **244 tests passed, 0 failed,
  0 cancelled, 0 skipped, 0 todo**, and production build passed.
- The four additional discovered tests are the unchanged UI-context tests.
- `grep -rc "assert" tests` summed totals: **972 before → 981 after**.
  This counts lines containing the word, including imports. The increase is nine
  assertion import lines: eight from splits plus the moved context test's import.
  AST counting of actual `assert.*` calls is **935 before → 935 after**.
  Named context assertions are also preserved: all **244 top-level test statements
  and their assertions are AST-identical**, compared with the original 240 tests
  plus the four previously undiscovered context tests. No assertions were removed.
- Temporarily added `src/shared/restructure-boundary-probe.ts` importing `node:fs`:
  the relocated architecture suite exited **1**, with **2 passed / 1 failed**, and
  reported `shared/restructure-boundary-probe.ts: node:fs`. Removed the probe in
  cleanup before the passing full check. No final source changes remain.
- `pnpm format`: passed. `git diff --check`: passed.
- `node scripts/build-host-test.mjs`: **exit 0**, emits `dist/host-tests.cjs`.
  Bundling verifies the moved entry point; it does not establish GUI activation.
- `git diff -- src pnpm-lock.yaml`: empty. Package manifest diff changes only `test`.
