# Verification evidence

Verified on 2026-11-04, Apple Silicon macOS. Target editor: **VS Code**. A prior isolated Cursor check was completed before the owner selected VS Code; no further Cursor checks are required or planned.

## Automated checks

- `pnpm check`: passed. Biome lint/format checks have no diagnostics; TypeScript checks pass; 18 tests pass; extension and webview bundles build.
- Tests cover provider RPC correlation, process exits and missing executables, Codex initialization/approval/worker events, session isolation, overlapping approval requests, transcript reconciliation, interruption, stale-process events, schema-validated recovery and checkpointing during continuous output, safe document access, symlink escapes, real Git worktree isolation, and rename-aware Git status parsing.
- `pnpm test:ui`: passed against the final webview build. Checks approval routing and question answers, per-thread drafts, sending to the selected provider, lead-owned worker controls, browser errors, and horizontal overflow at 320, 768, 1024, and 1440 pixels.
- Headless-browser screenshots were inspected for the overview and conversation. These screenshots use explicit test fixtures and do not establish live provider execution inside a webview.
- VS Code 1.143.1 extension-host test: passed. An isolated development-host profile activated `local-workspace.agent-workspace`, registered its commands, and opened the real webview. Evidence marker: `HOST_CHECK_PASSED` in the temporary profile’s renderer log. The normal VS Code profile was not changed.
- The copied Claude SDK imports successfully from the built extension’s own `dist/node_modules` directory.

## Live provider evidence

`pnpm smoke` passed with installed Codex CLI 0.166.0 and Claude Code 2.1.318. For each provider, a temporary-directory conversation returned a marker, the process closed, and a newly created adapter resumed the saved native session and recalled that marker. These were real signed-in CLI calls, not mock responses or direct model API requests. They consumed normal provider quota.

## 0.2.0 update

Verified on 2026-11-04 with fixtures and read-only CLI calls: `pnpm check` (48 tests) and `pnpm test:ui` passed, screenshots were inspected, `model/list` and `supportedModels()` returned real catalogs from both CLIs and through the `CLAUDE_CONFIG_DIR` launcher, the SDK MCP server connected to Claude Code, and Codex accepted `dynamicTools` on `thread/start`. No model turn ran for these checks, so they do not prove a live agent chooses and completes `run_agent`. `pnpm smoke:delegate` is the live acceptance test for that.

## 0.3.0 update

Verified on 2026-11-04 with fixtures: `pnpm check` and `pnpm test:ui` passed, and screenshots were inspected in dark and light themes at four widths. The preview now serves the build under the extension's CSP and VS Code's injected body padding, and the UI test fails on any CSP violation, a body padding other than zero, or a missing left divider. The editor toolbar button, status bar item, and tab icon were checked only by type checks and the packaged manifest: they have not been clicked in a running VS Code.

## 0.4.0 update

Verified on 2026-11-04 with fixtures: `pnpm check` and `pnpm test:ui` passed, under the extension's CSP. Adapter tests use a scripted Codex process and a scripted Claude query, and assert the real request shapes for plan mode and images. Screenshots of the side bar at three widths, the plan card, the `@` menu, and images were inspected. No live model turn ran, so these checks do not prove that either CLI's plan mode or image handling behaves as its types describe. The side bar placement, sparkle button, native diff placement, file search, image picker, and terminal capture use VS Code APIs that the browser test cannot reach, and they need a click-through in VS Code.

## 0.5.0 update

Verified on 2026-11-04 with fixtures: `pnpm check` and `pnpm test:ui` passed, under the extension's CSP. The UI test answers questions by keyboard (including multiple choice and a typed answer), skips with Esc, and checks the usage card's figures and that an elapsed limit is hidden. Parser tests use the protocol shapes from the generated Codex types and the SDK's declarations. No live turn ran, so neither CLI's usage reports nor `getContextUsage` and the SDK's experimental usage call have been seen working against a real account.

## 0.6.0 update

Verified on 2026-11-04 with fixtures only: `pnpm check` and `pnpm test:ui` passed, under the extension's CSP. No provider turns were run and `pnpm smoke` was not run, as agreed.

Covered: the exact settings each mode sends on each CLI, restoring Codex's settings after Ask, a refused Auto, plan file saving, Build using edited text, skill catalog parsing including malformed entries, the `/` menu by keyboard, muted chips, the panel, the one-nudge rule, and the plan editor in a browser.

**Not yet confirmed against real CLIs or a real VS Code window:**

- Auto on both CLIs, and whether your Claude model allows it.
- Ask staying read-only on both.
- Plan to Build on both, including whether Claude follows edited text passed through `updatedInput.plan`.
- A skill running on each, including `/name` through the SDK.
- `skills/list`, `skills/config/write`, and `mcpServer/startupStatus/updated` against your Codex version. They're read from its generated types.
- The custom editor, and the lazily loaded highlighter, in a real webview.

## Continuing in another agent

Verified on 2026-11-06. `pnpm check` (180 tests) and `pnpm test:ui` passed. Tests cover what the record contains and leaves out, the length limit, escaping its own tags, the delta and the empty delta, the unchanged plain thread attachment, unchanged CLI input without a chip, a sync point kept only after the CLI accepts a message, persistence, and action validation. The UI test checks that switching moves the draft with a chip and sends nothing, that the chip opens a preview, that no Codex model carries over to Claude, and that a linked thread is resumed rather than duplicated.

Existing data, checked on copies of the three local stores (69 threads, 1,261 messages): this build reads each one identically to the previous build, and the previous build reads a store written with the new fields, so going back a version is safe. Copies of the stores and the source were kept before any change.

Live, with Claude Code 2.1.318 and Codex CLI 0.166.0 in Ask mode on a temporary repository, nine checks passed:
- Codex recalled a codename told only to Claude.
- Claude resumed its original native session ID and recalled a codename told only to Codex.
- Claude still recalled its own first codename natively.
- The next record held only the new Codex turn (722 vs 880 characters), and Claude recalled it.
- With nothing new, nothing extra was sent.

Not checked live: Claude 2 and other profiles (including a Codex profile with its own `CODEX_HOME`), a new Claude thread started from a Codex one, Plan and Auto modes, the preview in a real VS Code window, and long threads near the limit.

## Limits of this verification

Real approval clicks with live provider tools, real internal worker delegation, the terminal-to-rich-chat handoff, long-running workloads, and every provider permission subtype still need interactive end-to-end acceptance in VS Code. Their application logic is covered where applicable by automated tests; the full native user workflow has not been certified. Rich transcripts do not backfill messages written in native terminals.

This extension does not import arbitrary existing CLI history. Unsupported provider requests are explicitly rejected and never automatically approved. A CLI or SDK upgrade may require adapter changes and should rerun integration checks.

## Reproduce the VS Code host check

```sh
pnpm build
node scripts/build-host-test.mjs
code --new-window --disable-extensions --disable-workspace-trust \
  --user-data-dir=/tmp/agent-workspace-vscode-test-data \
  --extensions-dir=/tmp/agent-workspace-vscode-test-extensions \
  --extensionDevelopmentPath="$PWD" \
  --extensionTestsPath="$PWD/dist/host-tests.cjs" /tmp/agent-workspace-host-project
```

Create the temporary test project folder first. Run GUI tests only with the owner’s authorization. The checked VSIX is intended for **Extensions: Install from VSIX…** in VS Code.

## Test layout verification (2026-11-07)

`pnpm check` passed after reorganizing the tests: **244 tests passed, 0 failed,
0 cancelled, 0 skipped, 0 todo**, with lint, typecheck, and production build passing.
The baseline was 240 tests; the four existing UI-context unit tests now run in the
normal suite. Node v24.15.0 expands the quoted recursive test glob.

- `tests/unit/` mirrors source paths for pure tests without real filesystem, process,
  or network work. Run `node --import tsx --test "tests/unit/**/*.test.ts"`.
- `tests/integration/` mirrors source paths for filesystem, Git, persistence, fake CLI,
  and bundler coverage. Run `node --import tsx --test "tests/integration/**/*.test.ts"`.
- `tests/architecture/boundaries.test.ts` scans the actual source tree. A temporary
  forbidden Node import made it fail; the probe was removed before the passing check.
- `tests/fixtures/host-route-fixture.ts` supplies shared fake routes.
- `tests/host/host-suite.ts` remains a separate VS Code suite;
  `node scripts/build-host-test.mjs` passed. No GUI host launch was performed.

See [the test restructure notes](restructure/tests.md) for the complete module map,
assertion counts, retained mixed-module coverage, and Git staging details. No live
provider smoke tests or UI browser suite ran for this restructure.
