# Integration boundaries

## Ownership

The extension host owns process adapters, workspace trust checks, worktree creation, filesystem access, local persistence, native terminals, and editor commands. The React webview receives validated application messages and snapshots; it cannot directly spawn commands or read files.

`Sessions` coordinates independently launched sessions and tracks observed provider workers. `Agent` exposes send, interrupt, and dispose. Provider events carry native IDs, status, complete messages, incremental text, approval callbacks, and worker observations. Provider-specific payloads are interpreted inside their adapters rather than imposing a new orchestration protocol on the agents.

The UI batches updates at 50 ms, sends transcript content only for the selected thread, memoizes Markdown messages, and renders the latest 100 messages initially. Earlier messages remain on disk and can be loaded. Document listings are cached until filesystem changes. Scroll follows new output only while the user is near the bottom.

## Codex

The adapter spawns `codex app-server --listen stdio://`, initializes a named client, and starts or resumes a native thread. It uses `turn/start`, `turn/interrupt`, item notifications, and turn completion. It preserves the CLI’s configured sandbox and approval policy rather than adding bypass flags. A model or effort is sent only when the user chose one in the picker; otherwise the CLI's configuration applies. `model/list` supplies the picker without starting a thread. Reasoning is shown from `item/reasoning/*` summaries, which is what Codex makes available to clients; `summary: auto` is requested on each turn. Nothing is shown when a turn exposes no reasoning text. Thread names come from `thread/name/updated`. Codex leaves names unset unless something sets one, so most threads keep their first-prompt title, matching Codex's own preview.

Supported server requests: command approval, file-change approval, and `requestUserInput` questions. Requests from provider-managed workers are presented through the lead session. Other request methods receive an explicit protocol error; no approval is implied. Collision-free callbacks stay in memory and are discarded on interruption or disconnect.

A worker is shown from `collabAgentToolCall` events, and events for a known child thread go to that worker's transcript rather than the lead's. Events a child emits before its ID is reported are not captured. Child events are not assumed to be separate fully controllable sessions. Codex app-server is still marked experimental in the installed CLI, so upgrades should rerun the adapter tests.

Source: [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Claude

The official Claude Agent SDK’s `query` launches the configured installed executable through `pathToClaudeCodeExecutable`. It loads user/project/local settings, uses the Claude Code system-prompt preset, preserves session IDs, and resumes through the CLI. No Anthropic model client is instantiated by this extension.

Options carry `model`, `effort`, and summarized adaptive thinking only when the choice applies; `supportedModels()` with an empty prompt stream supplies the picker without running a turn. Blocks are streamed under `<message id>-<index>` and matched to the final frames that repeat them. Frames with `parent_tool_use_id` go to that subagent's transcript (`forwardSubagentText`). A worker with no reported outcome when the query ends is recorded as interrupted. Session names are read from the `ai-title` and `custom-title` lines of the session's transcript file, under `CLAUDE_CONFIG_DIR` when set; only that transcript is read.

`canUseTool` supplies one-shot permission callbacks, including supported `AskUserQuestion` input. Abort signals resolve interrupted requests as denied. Streaming assistant messages reconcile with their final versions. Tool calls/results and provider-reported task events are displayed. Task IDs remain observations, not executable session IDs.

The shipped SDK version is pinned to 0.3.318; live smoke testing used Claude Code 2.1.318. Sign-in remains entirely within the CLI’s own flow. The extension never reads, copies, or renews OAuth credentials.

Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference), [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [authentication and credential boundaries](https://code.claude.com/docs/en/legal-and-compliance).

## Second Claude launcher

Shell aliases do not exist for a process launched by VS Code. The `claud2` agent resolves, in order: an explicit `agentWorkspace.claud2Path`; a `claud2` or `claude2` executable; or the primary `claude` executable with `CLAUDE_CONFIG_DIR` set to `agentWorkspace.claud2ConfigDir` (default `~/.claude-account2`) when that folder exists. The extension passes the folder path and never reads credentials from it.

## Running another agent

There are two ways to start one, and both create an ordinary provider session as a child thread:

- **The user types `@codex …`, `@claude …`, or `@claude2 …`** at the start of a message. This is the user's own instruction, so it starts directly.
- **An agent calls the `run_agent` tool.** Claude receives it as an in-process SDK MCP server with an `always_ask` policy, so it reaches `canUseTool` even where settings allow all MCP tools. Codex receives it through `dynamicTools` on `thread/start` and the `item/tool/call` request; the adapter emits an approval before doing anything. Declining starts nothing and tells the caller it was declined.

Limits that keep this from becoming a delegation loop: every agent-initiated call needs its own approval; a delegated session is not given the tool, so delegation cannot chain; the extension never sends a child's output to anything except the waiting `run_agent` call; and a typed @mention's result reaches the parent only if the user adds it to their next message. Stopping a lead stops its running delegates. Child approvals appear in the child and inline on the lead's card. The caller receives the provider-reported turn status alongside the child's final message, so a failed or interrupted child is reported as such.

`thread/resume` has no `dynamicTools` parameter, so `run_agent` on a resumed Codex thread depends on Codex restoring the thread's tools. A `run_agent` call with no delegate available is refused, not approved.

## Files and permissions

Webview actions are checked with a discriminated Zod schema, and `run_agent` arguments with their own. Native file links are confined to the selected checkout after realpath resolution; Markdown preview actions are restricted to `docs/agent-work/*.md`. Symlink escapes are rejected and symlinked documents are not indexed. External links support HTTP(S) only. Scripts and command links in agent Markdown are not executable; raw HTML and remote images are not rendered. The webview has a restrictive CSP and uses bundled assets.

Worktree operations use argument-array Git execution, not shell interpolation. New threads use the current checkout. A fresh branch and sibling worktree are created only after the user selects that option, which applies to one thread. The Changes panel reads `git status` and `git diff` for the thread's checkout, so it shows what is on disk rather than what an agent reported; each file also opens in VS Code's diff editor. Inline transcript diffs show what the provider reported for that tool call. The extension has no merge engine.

A new independent coding session can be linked to a lead; that relationship is organizational. The extension does not dispatch work without an approval or the user's own @mention, merge results automatically, or claim a Markdown checkbox proves runtime completion.

## Surfaces

The UI runs as a webview view in the secondary side bar (`agentWorkspace.chat`), which VS Code accepts from extensions from version 1.106; older hosts get the same view in the activity bar. **Open in Editor** adds a large editor-tab layout. All surfaces share threads through one controller and receive every snapshot; search results and attached images go only to the surface that asked. Code, diffs, and documents open in the active editor group, so review happens in the center.

## Plans

Plan mode uses each provider's own feature and adds no restrictions of its own. Claude gets `permissionMode: 'plan'`, and its `ExitPlanMode` request remains a permission decision that **Build it** or **Keep planning** answers. The SDK does not type that tool's input, so the adapter reads `plan`, then `planFilePath`, and otherwise says the text was not shared. Codex gets `collaborationMode` on `turn/start`, which its protocol marks experimental, and streams `item/plan/delta` then a `plan` item. Codex keeps a mode for later turns, so the adapter sends one whenever you have chosen a mode. A plan's status records only drafting, ready, incomplete, or your approval, and its checkboxes are never read as progress.

## Attachments and images

Files and folders go to the agent as workspace-relative paths in a context block, so it reads them under its normal permissions. They must resolve inside the workspace, including through symlinks. Threads, branch diffs, and terminal output go as capped text that says when it was cut. Terminal output needs shell integration, because the stable API exposes nothing else; a terminal's selection is still a proposed API. The transcript stores your text and chips, not the block.

Images are checked by their bytes (PNG, JPEG, GIF, WebP) and kept under generated names in one storage folder, the only user data the webview can load. Claude receives base64 image blocks, limited to 5 MB each. Codex receives `localImage` paths. Generated images are copied from `savedPath` or `result` into that folder, so the webview never needs access to Codex's own folders; a `fileId` with no bytes is reported as unavailable. `imageView` items display only for images inside the workspace.

## Usage

The composer shows only numbers a CLI reported, kept with the thread and labeled with their age. Nothing is estimated, and no cost is shown, because a dollar figure would mislead on a subscription. Reading them runs no model turn.

- **Codex:** context comes from `thread/tokenUsage/updated` (`last.totalTokens` against `modelContextWindow`). Limits come from `account/rateLimits/read` when the thread opens and `account/rateLimits/updated` after that. Updates are sparse, so a missing window keeps its last value.
- **Claude:** after each turn the adapter calls `getContextUsage({ detail: 'summary' })`, falling back to the last response's usage against `modelUsage[].contextWindow`. Plan limits come from the SDK's usage call, which it marks experimental and which reads the claude.ai usage endpoint. Both reads are bounded to 1.5 seconds and may fail without affecting the turn; API key sessions have no plan limits. `rate_limit_event` is not used because its `utilization` has no documented unit.

A window whose reset time has passed is hidden, since it no longer describes the present.

## Webview components

The composer and thread views follow the anatomy of [AI Elements](https://ui.shadcn.com/docs/ai-elements/base/model-selector) (Model Selector, Reasoning, Tool, Subagent, Prompt Input). The AI SDK itself is a model API client, which this extension does not use. Menus use Radix (non-modal) and cmdk; icons use Lucide; agent marks are drawn here because Lucide has no vendor logos. Markdown uses react-markdown with GFM and `remend` for half-written syntax while streaming. Streamdown was not used because it expects Tailwind and adds raw HTML handling, neither of which this project has. Code uses Shiki with its JavaScript regex engine, because the default engine needs WebAssembly, which the CSP does not allow. Mermaid diagrams show as code: the library is large and needs styles the CSP forbids.

The questions card and usage ring follow the structure of AI Elements' `Question` and `Context`, with this project's own markup and CSS. AI Elements itself is not installed: it needs Tailwind 4 and shadcn/ui, neither of which this project has, and its site says the project will be deprecated at the end of November 2026 in favor of shadcn/ui.

The webview's CSP allows no inline styles. `pnpm test:ui` serves the build under the same policy and fails on any violation, so a dependency that needs more is caught. Its preview also applies the `body { padding: 0 20px }` VS Code injects into webviews.

Design rules came from [Linear's redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) (neutral surfaces, limited accent, Inter), [Emil Kowalski](https://emilkowal.ski/ui/good-vs-great-animations) (trigger-origin menus, ease-out), [Rauno Freiberg](https://rauno.me/craft/interaction-design) (little motion on high-frequency actions), [Vercel's guidelines](https://vercel.com/design/guidelines) (tabular numbers, concentric radii, specific transitions), and [AI UX Playground](https://ai-design-patterns.pages.dev/blog/claude-vs-chatgpt-composer) (older models behind a submenu). Light and high-contrast VS Code themes get their own tokens.

[VS Code webview API](https://code.visualstudio.com/api/extension-guides/webview) provides the rendering and message boundary.
