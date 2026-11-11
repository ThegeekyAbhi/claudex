# Regenerate the visual guides

Use Node 24, pnpm 10.33.2, Python 3 with Pillow, and Playwright Chromium:

```sh
pnpm exec playwright install chromium
python3 -c 'import PIL; print(PIL.__version__)'
pnpm docs:accounts
```

The command builds the current webview and starts its local design preview on port 4173. Keep that port free. It drives real account components with sample snapshots and simulated profile-save responses. It never starts a provider, signs in, or writes account settings. The visible banner identifies sample accounts; CLI availability does not assert authentication.

Final GIFs and PNG posters are written to `media/guide/accounts-{add,switch}.{gif,png}`. Intermediate screenshots and timing manifests are in ignored `test-results/accounts-guide/`. The encoder uses Pillow with a 192-color palette and per-frame reading pauses; these are paced screenshots rather than a real-time provider recording. GIFs loop, and text instructions and final-state PNGs provide a static alternative.

The add scene creates Claude Work and Codex Work profiles using separate folders and pauses on the sign-in instruction. The switch scene assumes sign-in was completed separately and selects profiles/models without sending the draft. Assertions verify create requests, preserved draft, no submitted agent work, and browser errors.

After regeneration, inspect both GIFs at 1000 pixels wide and their posters. Run `pnpm check`, `pnpm test:ui`, and `pnpm package`. Check asset inclusion in the VSIX before release. Publishing is separate.

## Feature guides

```sh
pnpm docs:features
# Regenerate a single scene after a build:
node --import tsx scripts/capture-features.ts planning
```

The scene names are `modes`, `models`, `ask-markdown`, `visual-explanations`, `planning`, `questions`, `approvals`, `changes`, `chats-history`, `context`, `skills`, `subagents`, `handoff`, `worktrees`, and `usage`. Each scene starts with a fresh browser context and uses the same sample project. Intermediates are isolated under `test-results/feature-<scene>-guide/`. Each export includes a GIF and final-frame PNG in `media/guide/`.

`guide-capture.ts` shares the preview, browser, captions, cursor, and screenshot encoding helpers with the account guides. The capture banner reserves its own height so the entire composer stays visible. Provider-facing messages are collected by the fixture bridge and never forwarded to an extension host or installed CLI. Assertions check the relevant UI requests. Only sample response data is supplied.

Native VS Code editors and terminals cannot be shown by this browser harness. The plan, changes, and handoff clips explicitly stop at their native-editor requests. They must not imply the editor was captured, a file was saved, or implementation actually ran. The subagent scene uses a completed user-requested child card and explicitly chooses to add its result; it does not start a live child agent.
