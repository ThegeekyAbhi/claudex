# Layer renames

Renamed the source layers and grouped the existing modules by responsibility. This is a mechanical move: SRP makes each directory's purpose explicit, and DIP keeps the shared domain independent of Node and VS Code. No new runtime seam, abstraction, or behavior was introduced.

## Module map

| File or group | Responsibility |
| --- | --- |
| `src/shared/model.ts` | Existing public barrel, with the same exports. |
| `src/shared/domain/session.ts` | Existing session, transcript, snapshot, and provider contract types/schemas. |
| `src/shared/domain/modes.ts`, `thinking.ts`, `capabilities.ts` | Mode, thinking, and provider capability rules. |
| `src/shared/domain/agents.ts`, `profiles.ts`, `delegation.ts` | Agent identity, profile definitions, and delegation rules. |
| `src/shared/domain/skills.ts`, `nudges.ts`, `preferences.ts` | Shared skill, nudge, and preference rules. |
| `src/shared/domain/text.ts`, `diff.ts` | Text and diff transformations. |
| `src/shared/domain/persistence.ts`, `session-packet.ts` | Restore rules and cross-agent transcript packets. |
| `src/shared/protocol/actions.ts` | Unchanged webview action schemas. |
| `src/shared/protocol/snapshot.ts` | Snapshot projection and incremental merging. |
| `src/shared/protocol/events.ts` | Existing transcript/provider event application. |
| `src/shared/guidance/planning-guidance.ts`, `explain-guidance.ts` | Existing planning/explanation strings and versions. |
| `src/application/sessions/session-manager.ts` | `Sessions` facade and service composition. |
| `src/application/sessions/turn-lifecycle.ts` | Turns, provider events, interruption, and disposal. |
| `src/application/sessions/session-approvals.ts` | Pending approvals and transitions. |
| `src/application/sessions/session-plans.ts` | Plan lifecycle and plan file port. |
| `src/application/sessions/session-delegation.ts` | Delegated children and completion waiters. |
| `src/application/sessions/session-files.ts` | Turn observations and diff reconciliation. |
| `src/application/sessions/session-persistence.ts` | Existing session serialization, loading, and save queue. |
| `src/application/sessions/session-types.ts` | Existing service port types. |
| `src/application/sessions/agent-factory.ts` | Launcher resolution and provider registry dispatch. |
| `src/application/catalogs/model-catalog.ts`, `skill-catalog.ts` | CLI model and skill catalogs. |
| `src/infrastructure/git.ts` | Git subprocess helper. |
| `src/infrastructure/file-observer.ts` | Existing disk snapshots and observed diffs. |
| `src/infrastructure/worktrees.ts` | Worktree creation and status parsing; has no VS Code import. |
| `src/extension/extension.ts`, `controller.ts`, `surfaces.ts` | Activation, composition, and webview surfaces. |
| `src/extension/router.ts`, `action-groups.ts`, `handlers/*` | Validated action dispatch and existing feature handlers. |
| `src/extension/agent-paths.ts`, `launcher.ts` | Profile path handling and installed CLI discovery. |
| `src/extension/attachments.ts`, `changes.ts`, `documents.ts`, `plans.ts`, `workspace-search.ts` | Existing workspace/editor integration helpers. |
| `src/extension/terminal-capture.ts` | Existing native terminal capture. |
| `src/providers/*`, `src/webview/*` | Same adapter/UI structure; imports updated only. |

The target layout fits the existing modules. Types already combined in `session.ts` and event handling already combined in `events.ts` were not split, preserving the requested move-only scope. File observation retains its existing limits and reconciliation rules unchanged.

## References and boundaries

Updated source, tests (including embedded build fixtures), scripts, current integration documentation, Biome overrides, and the boundary scanner to the new paths. Shared and webview imports reject application/infrastructure/extension/providers dependencies; shared also rejects webview dependencies. Application, infrastructure, and providers reject extension and VS Code imports. Existing assertions remain, and boundary coverage now includes infrastructure.

`README.md`, `AGENTS.md`, `tsconfig.json`, `scripts/build-host-test.mjs`, and `tests/host/host-suite.ts` required no edits: they contain no obsolete layer paths. In particular, the host test builder still bundles `tests/host/host-suite.ts`, and that suite accesses the installed extension through VS Code rather than source imports. All AGENTS.md rules remain word for word. Historical restructure notes have only the requested notice prepended. Old path search hits occur only in those historical notes; their contents intentionally record the earlier structure.

## Deliberately unchanged

- Dependencies, package manifest, lockfile, settings, commands, views, webview message types, schemas, session formats, local IDs, provider behavior, and runtime output names.
- The existing barrel and module implementations; no size-driven splits or bug fixes.
- `scripts/ui-check.ts` except its single `Session` import line.
- No live provider smoke tests or UI server/browser tests were run. No commits, branches, pushes, or other worktrees were changed.

## Risks and Git constraint

No new suspected functional bugs were identified. This change preserves existing module behavior, including any pre-existing edge cases described in the earlier notes.

The sandbox rejected the normal `git mv` index lock at the worktree's Git metadata path. All moves were then performed with `git mv` using a temporary copy of the index (`GIT_INDEX_FILE` under `/tmp`). The real index was untouched, so the working tree shows old paths deleted and new paths untracked until the orchestrator stages them; Git can detect the renames then. New source directories must be included when reviewing/staging this change.

## Verification

- Used pnpm **10.33.2**; ran `pnpm format`.
- `pnpm check` exited **0**: lint, typecheck, **240 tests passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**, and production build passed.
- Temporarily added a shared guidance probe importing Node and extension paths. Biome exited **1**, reporting two `noRestrictedImports` violations. The source boundary suite exited **1** and reported both imports (2 tests passed, 1 failed). Removed the probe before the passing full check.
- Compared TypeScript syntax trees with imports excluded and re-export paths normalized: **175 of 178** non-boundary source/test/script files had identical remaining trees. The three reviewed differences are the build entry string, the unchanged barrel exports reordered by Biome, and source paths inside the host-registry test's embedded build fixture. No executable application logic changed.
- `node scripts/build-host-test.mjs` exited **0** and produced `dist/host-tests.cjs`.
- Confirmed package `main` remains `./dist/extension.cjs` and that the production build emits that file. The build entry is now `src/extension/extension.ts`; output paths are unchanged.
- The requested old-path search has no hits in source, tests, scripts, current docs, root Markdown, or Biome config; only the intentionally preserved historical notes match.
