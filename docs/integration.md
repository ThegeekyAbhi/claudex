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

## Agent profiles

Agents are profiles (`src/shared/domain/profiles.ts`): a provider (`claude` or `codex`, the two adapters), an optional home folder and an optional executable.

**Where profiles come from** (`src/extension/launcher.ts`):
- the built-ins `claude` and `codex`
- `agentWorkspace.profiles`
- the pre-profile second Claude account, `claud2`. It is listed only when saved threads use it, a `claud2`/`claude2` executable exists, or the old settings are set. A wrapper is run as-is; otherwise `claude` runs with `CLAUDE_CONFIG_DIR` set to the old folder.

**Checks:**
- Detection runs `--version` on activation and when a related setting changes. It reports `ready`, `missingCli` or `missingFolder` and never installs anything.
- Labels, @mentions, the `run_agent` enum and the agent rail are built from the current list. The host and the webview share it through each snapshot.
- Webview actions must name a profile that exists. Starting one also requires that it can run.
- A home folder is passed as `CLAUDE_CONFIG_DIR` (the SDK `env`) or `CODEX_HOME` (the app-server process env). Built-ins get no extra environment. A missing folder is an error, never a fallback to the default account.

**Saving:**
- Threads save `profileId` only for non-built-in profiles, so built-in threads keep the earlier format. The older `claudeCommand: "claud2"` is read as `profileId: "claud2"` and written back alongside it, so an older Claudex still runs those threads on the second account.
- Profile edits go through VS Code's input boxes and folder picker, and only change the `agentWorkspace.profiles` setting. The webview names an action and never a path, except a suggested folder, which the host checks against its own list. No credential is read, copied or stored. Signing in is the CLI's own flow in a terminal.

## Running another agent

There are two ways to start one, and both create an ordinary provider session as a child thread:

- **The user types `@codex …`, `@claude …`, or a profile's handle** at the start of a message. This is the user's own instruction, so it starts directly.
- **An agent calls the `run_agent` tool.** Claude receives it as an in-process SDK MCP server with an `always_ask` policy, so it reaches `canUseTool` even where settings allow all MCP tools. Codex receives it through `dynamicTools` on `thread/start` and the `item/tool/call` request; the adapter emits an approval before doing anything. Declining starts nothing and tells the caller it was declined.

Limits that keep this from becoming a delegation loop: every agent-initiated call needs its own approval; a delegated session is not given the tool, so delegation cannot chain; the extension never sends a child's output to anything except the waiting `run_agent` call; and a typed @mention's result reaches the parent only if the user adds it to their next message. Stopping a lead stops its running delegates. Child approvals appear in the child and inline on the lead's card. The caller receives the provider-reported turn status alongside the child's final message, so a failed or interrupted child is reported as such.

`thread/resume` has no `dynamicTools` parameter, so `run_agent` on a resumed Codex thread depends on Codex restoring the thread's tools. A `run_agent` call with no delegate available is refused, not approved.

## Continuing in another agent

No CLI can resume another CLI's native session, and this extension does not write either CLI's session files. Continuing instead sends a record built by `src/shared/domain/session-packet.ts` from the transcript this extension already stores: your messages, agent replies, tool lines with the provider-reported status and exit code, the tail of a failed command's output, files from reported or observed diffs, and the plan. Thinking summaries stay behind. The record is wrapped in `<context_from_another_agent>`, says it is history rather than instructions, and escapes any copy of its own tags inside it. It keeps the first message and as much of the latest as fits the chosen limit, and says how much it left out.

It travels as a `thread` attachment with `history` set, through the same `SessionInput.context` path as other attachments, so system prompts, modes, tools, and every request field stay as they were. Without the chip each CLI receives exactly what it did before. A thread attachment without `history` still sends only the last reply.

`continuedFrom` links the new thread to its source. `synced` records, per linked thread, the last of its messages this thread has been sent; it is written only after the CLI accepts the message. Going back to a linked thread resumes its native session and sends only later messages; nothing new sends nothing. All three fields are optional, so earlier versions still load a store that has them.

## Files and permissions

Webview actions are checked with a discriminated Zod schema, and `run_agent` arguments with their own. Native file links are confined to the selected checkout after realpath resolution; Markdown preview actions are restricted to `docs/agent-work/*.md`. Symlink escapes are rejected and symlinked documents are not indexed. External links support HTTP(S) only. Scripts and command links in agent Markdown are not executable; raw HTML and remote images are not rendered. The webview has a restrictive CSP and uses bundled assets.

Worktree operations use argument-array Git execution, not shell interpolation. New threads use the current checkout. A fresh branch and sibling worktree are created only after the user selects that option, which applies to one thread. The Changes panel reads `git status` and `git diff` for the thread's checkout, so it shows what is on disk rather than what an agent reported; each file also opens in VS Code's diff editor. Inline transcript diffs show what the provider reported for that tool call. The extension has no merge engine.

A new independent coding session can be linked to a lead; that relationship is organizational. The extension does not dispatch work without an approval or the user's own @mention, merge results automatically, or claim a Markdown checkbox proves runtime completion.

## Surfaces

The UI runs as a webview view in the secondary side bar (`agentWorkspace.chat`), which VS Code accepts from extensions from version 1.106; older hosts get the same view in the activity bar. **Open in Editor** adds a large editor-tab layout. All surfaces share threads through one controller and receive every snapshot; search results and attached images go only to the surface that asked. Code, diffs, and documents open in the active editor group, so review happens in the center.

## Modes

Each adapter maps a mode to its CLI's real settings. `src/shared/domain/capabilities.ts` describes what each CLI supports as data, so the UI never branches on provider name. It lives in `shared` because the webview reads it.

| Mode | Claude | Codex (`turn/start`) |
| --- | --- | --- |
| unset | nothing sent, so `permissions.defaultMode` applies | nothing sent |
| Ask | `dontAsk`, `disallowedTools: Edit, Write, NotebookEdit`, no `run_agent` server | `readOnly` sandbox, no network, `approvalPolicy: never`, `run_agent` refused |
| Plan | `plan` | `collaborationMode: plan` with the thread's original settings |
| Auto | `auto` | the thread's original settings, `approvalsReviewer: auto_review` when `approvalPolicy` is `on-request`; otherwise `user`, with a notice and the chip showing **Your Codex settings** |

A saved `mode: 'agent'` from an earlier version loads as unset, and the session keeps its ID.

Codex keeps these settings from turn to turn, so the thread's original `approvalPolicy`, `approvalsReviewer`, and `sandbox` are captured once from the start response and stored with the session. Every explicit mode restates them, which is what lets a thread leave Ask. Claude runs one query per turn, so it needs none of this.

The composer shows `init.permissionMode` when Claude reports one. If that differs from the request, the thread gets a notice and the composer a nudge. Codex doesn't report a mode, so its chip shows the one sent and accepted. Bypass and full access are never requested. A setting your own CLI already has is left as it is.

## Plans

Plan mode uses each provider's own feature. A finished plan is written by the extension to `<storage>/plans/<title>_<id>.plan.md`, because plan mode can't write files itself. It stays ordinary Markdown. A failed write costs only the file: the plan stays in the thread, with a notice.

`*.plan.md` opens in VS Code's Markdown preview (`markdown.showPreview`), and **Open as text** is VS Code's own editor on the same file. A plan file with no owning thread can be read but not built.

**Build** saves any open edits and reads the file when clicked.

- **Claude, with `ExitPlanMode` waiting:** answered with `updatedInput.plan` set to your edited text, then `setPermissionMode` to the chosen mode.
- **Codex, or no request waiting:** a normal turn. An unedited plan sends "Implement the plan."; an edited one sends its text, so nothing depends on the CLI being able to read our storage folder.
- **Another agent:** a linked thread whose prompt carries the text. A waiting request is declined.

Text typed while a plan waits goes back as the denial message, so Claude revises in the same turn. Nothing is inferred from checkboxes, and the card says "Build started", never done. A revised plan replaces the thread's file, including hand edits the agent wasn't told about.

## Skills

`src/application/catalogs/skill-catalog.ts` reads what each CLI reports. No turn runs and no quota is used.

- **Claude:** `query.supportedCommands()` on an idle session with `settingSources: user, project, local`, leaving out `builtin` entries. It reports no source or path, so none is shown.
- **Codex:** `skills/list`, with malformed entries reported as problems. `skills/config/write` turns one on or off.

Catalogs load in the background, at most every 30 seconds per agent, and are refreshed behind the `/` menu, so opening it never waits on a CLI. A skill coming back from the webview is checked against the catalog before it's sent.

Invocation is native: Claude gets `/name` for the first skill and the rest named in the text, and Codex gets `{ type: 'skill', name, path }` inputs. A chip is a request. "Used skill" appears only for a real Claude `Skill` tool call. Codex's protocol reports no such event, so nothing claims one ran.

## Attachments and images

Files and folders go to the agent as workspace-relative paths in a context block, so it reads them under its normal permissions. They must resolve inside the workspace, including through symlinks. Threads, branch diffs, and terminal output go as capped text that says when it was cut. Terminal output needs shell integration, because the stable API exposes nothing else; a terminal's selection is still a proposed API. The transcript stores your text and chips, not the block.

Images are checked by their bytes (PNG, JPEG, GIF, WebP) and kept under generated names in one storage folder, the only user data the webview can load. Claude receives base64 image blocks, limited to 5 MB each. Codex receives `localImage` paths. Generated images are copied from `savedPath` or `result` into that folder, so the webview never needs access to Codex's own folders; a `fileId` with no bytes is reported as unavailable. `imageView` items display only for images inside the workspace.

## Usage

The composer shows only numbers a CLI reported, kept with the thread and labeled with their age. Nothing is estimated, and no cost is shown, because a dollar figure would mislead on a subscription. Reading them runs no model turn.

- **Codex:** context comes from `thread/tokenUsage/updated` (`last.totalTokens` against `modelContextWindow`). Limits come from `account/rateLimits/read` when the thread opens and `account/rateLimits/updated` after that. Updates are sparse, so a missing window keeps its last value.
- **Claude:** context comes from the last response's usage against `modelUsage[].contextWindow`, so reading it adds no wait to a turn. Plan limits are read in the background when a session starts, through the SDK's usage call, which it marks experimental. API key accounts have none.

A window whose reset time has passed is hidden, since it no longer describes the present.

## Staying out of the way

The extension doesn't sit between you and the CLI. Nothing is awaited between Send and the provider call except attachment reads you asked for. While a thread streams, an update carries that thread's tail, and catalogs or documents only when they changed. Shiki loads as its own chunk the first time code appears, and falls back to plain code if that fails. `tests/unit/shared/protocol/snapshot.test.ts` and `tests/integration/application/sessions/turn-lifecycle.test.ts` guard these.

## Source layout

Dependencies point inward: `webview`, `extension`, `application`, `infrastructure`, and `providers` depend on `shared`; `shared` has no dependency on those layers.

- `src/shared`: the domain, with no Node or VS Code APIs. Schemas, events, modes, capabilities, skills, nudges.
- `src/providers`: one adapter per CLI.
- `src/application`: session use cases and model/skill catalogs.
- `src/infrastructure`: Git execution, file observation, and worktree operations.
- `src/extension`: VS Code activation, controller, surfaces, plans, documents.
- `src/webview`: `app`, `features`, `components/ui` (shadcn), `lib`.

## Webview components

The composer and thread views follow the anatomy of [AI Elements](https://ui.shadcn.com/docs/ai-elements/base/model-selector) (Model Selector, Reasoning, Tool, Subagent, Prompt Input). The AI SDK itself is a model API client, which this extension does not use. Menus use Radix (non-modal) and cmdk; icons use Lucide; agent marks are drawn here because Lucide has no vendor logos. Markdown uses react-markdown with GFM and `remend` for half-written syntax while streaming. Streamdown was not used because it expects Tailwind and adds raw HTML handling, neither of which this project has. Code uses Shiki with its JavaScript regex engine, because the default engine needs WebAssembly, which the CSP does not allow. Mermaid loads on demand for settled diagram blocks, with readable source on failure. SVG rendering requires inline styles; scripts remain nonce restricted. Plans open in the standard Markdown preview, with implementation controls on their conversation cards.

The questions card and usage ring follow the structure of AI Elements' `Question` and `Context`. shadcn/ui components live in `src/webview/components/ui`, copied in as source. Tailwind 4 compiles to `dist/app.css`, with no Preflight, and its tokens map onto the project's variables so every VS Code theme still applies. Older features keep their own CSS until they're next touched.

The webview's CSP allows no inline styles. `pnpm test:ui` serves the build under the same policy and fails on any violation, so a dependency that needs more is caught. Its preview also applies the `body { padding: 0 20px }` VS Code injects into webviews.

Design rules came from [Linear's redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) (neutral surfaces, limited accent, Inter), [Emil Kowalski](https://emilkowal.ski/ui/good-vs-great-animations) (trigger-origin menus, ease-out), [Rauno Freiberg](https://rauno.me/craft/interaction-design) (little motion on high-frequency actions), [Vercel's guidelines](https://vercel.com/design/guidelines) (tabular numbers, concentric radii, specific transitions), and [AI UX Playground](https://ai-design-patterns.pages.dev/blog/claude-vs-chatgpt-composer) (older models behind a submenu). Light and high-contrast VS Code themes get their own tokens.

[VS Code webview API](https://code.visualstudio.com/api/extension-guides/webview) provides the rendering and message boundary.
