> Paths in these historical notes were later renamed; see [renames.md](renames.md).

# Layer boundaries

## Changes and design

- Moved the unchanged `git(cwd, args)` implementation from the VS Code host into
  `src/harness/git.ts`. The observer now imports it directly; worktree operations use
  the same helper. This separates process execution from host responsibilities (SRP)
  and removes the harness dependency on the host layer.
- Moved both guidance modules, including their version constants, unchanged into
  `src/core/guidance/`. The harness and webview now share pure domain constants
  without introducing Node code into the webview dependency graph.
- Added Biome 2.3.13 `overrides` using `style.noRestrictedImports`. Core excludes
  Node, vscode and the other source layers; webview excludes Node, vscode and the
  three Node layers; harness and providers exclude vscode and host imports.
  The installed configuration schema supports `paths` and gitignore-style
  `patterns`, which these overrides use.
- Added a small import scanner because Biome patterns match source specifiers
  rather than resolving paths. It normalizes relative paths and the existing
  `@/` alias, and also excludes bare Node built-ins from core and webview. Focused
  tests exercise imports, type imports, re-exports, dynamic imports, require,
  allowed dependencies, and the extracted Git helper.

## Module map

| File | Responsibility |
| --- | --- |
| `src/harness/git.ts` | Execute Git with the existing cwd, argument, buffer and error behavior. |
| `src/host/worktrees.ts` | Worktree creation and status parsing; compatibility export of `git`. |
| `src/harness/file-observer.ts` | Existing disk observation, now depending directly on the Node Git helper. |
| `src/core/guidance/planning-guidance.ts` | Unchanged planning guidance text and version. |
| `src/core/guidance/explain-guidance.ts` | Unchanged explanation guidance text and version. |
| `src/harness/planning-guidance.ts` | Compatibility re-export of the core planning constants. |
| `src/harness/explain-guidance.ts` | Compatibility re-export of the core explanation constants. |
| `biome.json` | Immediate import restrictions for the four constrained source layers. |
| `tests/architecture/boundaries.test.ts` | Source graph scan and positive/negative scanner cases. |
| `tests/integration/infrastructure/git.test.ts` | Git helper stdout, cwd, argument boundaries, rejection and export identity checks. |

The only changes to session-manager and conversation are the permitted guidance
imports, sorted by Biome.

## Deliberately unchanged

`resolveInside` remains in `src/providers/shared/paths.ts`. It is not pure: it uses
Node path operations and filesystem `realpath` to reject traversal and symlink
escapes. Providers, harness and host already consume it in permitted directions.
Moving it into core would break core's platform independence; another shared Node
layer would add scope without improving these enforced dependencies.

The old harness guidance modules and host Git export remain as thin compatibility
exports, preserving existing callers and test imports without duplicate logic.
Dependencies, lockfile, schemas, persisted data, command/settings/message names,
provider behavior, and session lifecycle logic are unchanged. Existing tests and
assertions are unchanged. No live provider or UI integration tests were run.

## Risks and suspected bugs

No runtime bug was identified in the moved implementations. The scanner is
intentionally a small regex-based check, not a TypeScript parser: import-like text
in comments or strings can cause false positives, and computed dynamic specifiers
are outside its coverage. New path aliases must also be added to the scanner.
Biome checks literal specifiers and may conservatively reject a future same-layer
subdirectory with the name of a forbidden layer. These are enforcement limitations,
not changes to extension behavior.

## Verification

- Confirmed pnpm version `10.33.2`.
- Compared the new guidance files against their old Git HEAD contents byte for
  byte; both are identical. Also compared the extracted Git implementation byte
  for byte, including its 10 MiB maxBuffer and unmodified stdout return.
- Temporarily added `src/core/guidance/boundary-probe.ts` importing `node:fs` and
  `../../host/worktrees`. Biome exited 1 with two
  `lint/style/noRestrictedImports` errors. Removed the fixture.
- Temporarily added the same fixture importing `@/../host/worktrees`. The source
  scan exited 1 and reported that exact forbidden dependency (2 tests passed,
  1 failed). Removed the fixture.
- Ran `pnpm format` and `git diff --check`.
- Final `pnpm check`: passed lint, typecheck, tests and build; **194 tests passed,
  0 failed, 0 cancelled, 0 skipped, 0 todo**.
