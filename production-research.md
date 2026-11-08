# Claudex production integration audit and implementation plan

Audit date: **2026-11-08**. Repository baseline: commit `5f48a42`, with existing working-tree changes; findings describe the inspected working tree, not an immutable release artifact. Manifest version at inspection: `0.8.8`.

This is a research report and proposed plan. It does not authorize implementation, provider installation, publication, credential changes, or live provider tests. Claudex is an independent VS Code extension; this report assumes no dependency on Veeby or another video editor.

## 1. Executive assessment

**Claudex already executes the actual provider harnesses. The core integration choices should largely be preserved.**

- Claude uses the official `@anthropic-ai/claude-agent-sdk`, explicitly pointed at the user's installed Claude Code executable.
- Codex invokes the user's installed `codex app-server` over stdio. It does not use `@openai/codex-sdk`.
- Provider processes execute tools, manage context, and run their native agent loops. Claudex translates protocol events, displays approvals, persists references, and adds application features.
- Native session resumption, interrupted-state recovery, streaming, and cross-provider context transfer already have substantial implementations.

**The repository is not yet evidence-backed for a universal, subscription-only, cross-platform Marketplace release.** The principal release gates are:

1. Resolve the permitted public distribution/authentication category for the exact Claude SDK integration and the intended Codex product model.
2. Verify effective authentication and billing mode before model work. A native login alone does not prove that included subscription usage will be used.
3. Add runtime compatibility checks, particularly where older Claude versions can ignore permission-policy fields.
4. Complete Windows discovery and launch behavior, and verify process shutdown on each OS.
5. Establish native-session and checkout ownership across threads, terminals, reloads, and windows.
6. Publish a support matrix backed by real packaged-extension tests.

Recommended strategy: **a discovery-first hybrid**. Use installed, unmodified provider runtimes and their own sign-in flows; provide platform-specific guidance, compatibility checks, recovery, and optional managed components only where their licensing and maintenance obligations have been established. Do not add model API integration, OAuth token handling, a hosted backend, an automatic delegation loop, or a permission bypass.

## 2. Scope, evidence, and verification performed

Inspected the manifest, dependency lock, build/package scripts, provider adapters and transport, catalogs, authentication launchers, session orchestration and persistence, native history integration, terminal handoff, webview boundary, tests, and existing integration/verification documentation. Official documentation and relevant upstream Codex implementation references were retrieved during the audit.

Evidence labels used below:

- **Code verified:** established by the inspected implementation. This does not establish successful behavior on every operating system.
- **Documentation verified:** supported by a current official source. This does not establish that Claudex implements the documented capability.
- **Repository-recorded:** prior verification described in repository documents, not reproduced during this audit.
- **Unverified:** requires a live experiment, packaged-extension test, or provider clarification.

Read-only checks run with pnpm **10.33.2**:

| Check | Result |
| --- | --- |
| `pnpm --version` | `10.33.2` |
| `pnpm lint` | Exit 0; two existing non-null assertion warnings in `tests/integration/providers/history/claude-tail.test.ts:43` and `:102`; no fixes applied |
| `pnpm typecheck` | Passed |
| `pnpm check` | Not run: includes a build that writes artifacts |
| `pnpm test:ui` | Not run |
| `pnpm smoke`, `pnpm smoke:delegate` | Not run; real provider calls consume user quota |
| VSIX packaging, installation, GUI host tests | Not run |

No dependencies were installed, no credentials were read, and no source files were modified by this audit. The requested report is the only authored artifact.

This is an integration and portability audit, not a full dependency vulnerability scan, penetration test, UI accessibility review, or benchmark. Provider terms can change; release-time review remains necessary.

## 3. Current implementation

### 3.1 Architecture and dependencies

The repository has a useful separation of responsibilities:

| Layer | Responsibility and evidence |
| --- | --- |
| `src/shared` | Domain data, schemas, actions, capabilities, and handoff records; no Node or VS Code dependencies intended |
| `src/providers` | Claude/Codex adapters, subprocess transport, native history readers, tool formatting, and usage parsing |
| `src/application` | Session lifecycle, approvals, persistence, delegation, plans, and provider catalogs |
| `src/infrastructure` | Git, filesystem observation, and worktrees |
| `src/extension` | VS Code activation, commands, terminals, documents, webview surfaces, runtime discovery, and routing |
| `src/webview` | React presentation and typed message exchange |

`tests/architecture/boundaries.test.ts:9–41` and `:63–100` statically enforce dependency boundaries, including forbidden Node/VS Code imports from shared/webview code.

The manifest uses `main: ./dist/extension.cjs`, requires VS Code `^1.96.0`, has no browser entry, and explicitly disables virtual workspaces. It does not declare an explicit `extensionKind`. See `package.json:22–50`.

The principal provider dependency is pinned to `@anthropic-ai/claude-agent-sdk: 0.3.318`. There is no direct Codex SDK or OpenAI model API dependency. The installed Claude SDK metadata identifies Claude Code `2.1.318` and Node `>=18.14.0`. These are package facts, not a guarantee that any externally selected Claude binary is compatible.

`scripts/build.mjs:7–15` builds the extension for Node 20 and leaves the Claude SDK external. `scripts/build.mjs:50–59` copies the SDK package into `dist/node_modules`. `scripts/package.mjs:6–17` uses `vsce package --no-dependencies`. The VSIX therefore relies on prepared `dist` contents.

The lockfile includes optional Claude SDK packages for Darwin, Windows, and Linux x64/ARM64, including Linux musl variants. The build copies the main SDK package, while the runtime explicitly chooses an installed CLI. Do not treat the lockfile's platform packages as proof that a managed, self-contained provider runtime ships in the VSIX.

### 3.2 Claude

`ClaudeAgent.send()` in `src/providers/claude/adapter.ts:184–258` calls SDK `query()` with:

- `cwd: session.cwd`;
- `pathToClaudeCodeExecutable: this.executable`;
- `resume: session.nativeId`;
- `settingSources: ['user', 'project', 'local']`;
- the `claude_code` system prompt preset;
- partial messages and subagent text forwarding;
- the selected mode, model, effort, and thinking options;
- a `canUseTool` callback.

The adapter captures native `session_id` values from SDK messages. It consumes streamed text/thinking/tool events and maps native worker events. Result error semantics determine failed/completed state; a stream without a result is failed or interrupted. See `:233–289`, `:480–495`, and `:626–677`.

`permission()` at `:291–361` presents tool approvals and questions, correlates responses, and denies cancelled requests. The provider's policy remains an enforcement layer: a callback must not be represented as seeing every native tool invocation.

`delegateServer()` at `:105–145` exposes a custom SDK MCP `run_agent` tool. This extends the native harness; it does not implement a replacement tool loop. It requests `always_ask` policy. Worker-row correlation at `:147–163` uses undocumented `claudecode/toolUseId` metadata and a FIFO fallback, which deserves targeted concurrency coverage.

The adapter creates and closes a query for each turn, resuming the saved native session for subsequent turns. Native state can persist without a permanently alive Claude process.

### 3.3 Codex

`CodexAgent.connect()` in `src/providers/codex/adapter.ts:119–188` starts:

```text
codex app-server --listen stdio://
```

It sends `initialize`, advertises `experimentalApi: true`, sends `initialized`, then calls `thread/start` or `thread/resume`. It saves the returned native thread ID and settings. `send()` at `:237–258` issues `turn/start` with text, local image paths, skill inputs, and provider settings.

`src/providers/process.ts:11–99` implements JSONL RPC transport and request correlation. This is protocol plumbing, not a model/tool loop. Pending requests time out after 60 seconds; transport failure rejects outstanding requests.

The adapter maps native messages, command output, file changes, reasoning, MCP calls, images, and workers. Its server-request handler at `src/providers/codex/adapter.ts:646–714` supports command/file approvals, user questions, and its custom dynamic tool. Unknown requests receive an explicit `-32601` error and a visible notice. No approval is granted for unsupported requests.

### 3.4 Authentication and profiles

`ProfilesHandlers.signIn()` in `src/extension/handlers/profiles.ts:330–344` opens the installed provider in a VS Code terminal. Codex receives `login`; Claude opens its native interactive flow and instructs the user to use `/login` if needed. Claudex does not implement an OAuth flow or copy provider tokens in this path.

`src/extension/agent-paths.ts:31–62` separates profiles using `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. A missing profile/home is an error rather than a fallback to the default account.

However, both adapters inherit the extension host environment: `src/providers/process.ts:29–33` and `src/providers/claude/adapter.ts:206–224`. Neither checks effective subscription authentication before model work. Current onboarding deliberately reports installation status only, not verified sign-in mode: `src/shared/domain/onboarding.ts:5–9`.

**Verified gap:** the extension cannot currently guarantee subscription-backed usage or distinguish a subscription from saved API credentials, environment overrides, credential helpers, cloud providers, or custom model-provider configuration.

### 3.5 Sessions, lifecycle, and recovery

`src/extension/controller.ts:218–231` loads saved state and detects installations on activation. Provider adapters are created lazily on Send at `src/application/sessions/turn-lifecycle.ts:93–109`. Activation does not restart unfinished work.

`src/application/sessions/session-persistence.ts:40–60` restores schema-validated session data and excludes live approval callbacks/transitions from serialization. `src/shared/domain/persistence.ts:137–185` converts unfinished sessions/tools to interrupted, unfinished plans to incomplete, and unfinished image work to failed. Native IDs and profile identity remain persisted.

Generation guards in `turn-lifecycle.ts:94–102` reject stale adapter events. Interrupt handling at `:216–259` waits for native acknowledgement with an outer 15-second limit and reports uncertain stopping as failed. Codex additionally waits for a matching terminal turn event, not merely the interrupt RPC reply. Claude calls SDK interrupt, closes the query, and waits for turn completion.

These choices preserve truthful local state. They do not prove that every descendant command or MCP process stops after a provider crash.

### 3.6 Native history and handoff

The main switching UI already uses separate linked sessions. `src/webview/app/use-turns.ts:37–66` moves the draft, adds a removable context chip, and reuses an existing linked thread when switching back. Switching alone sends nothing. Provider model/effort selections are not blindly copied across providers.

`src/shared/domain/session-packet.ts:106–176` builds a bounded record containing the original goal, visible history, plan status, changed paths, and tool outcomes. It excludes thinking and approvals, labels interrupted/failed source state, warns that history is untrusted, and instructs the recipient to inspect actual files. Limits are character budgets, not exact token counts: 40,000 for recent and 300,000 for full history.

Per-source cursors support delta transfer. `src/extension/attachments.ts:127–141` constructs the context, and `turn-lifecycle.ts:128–132` stores cursors after adapter Send resolves. This records accepted delivery, not proof that the recipient understood or completed the task.

The current code also lists and opens existing native sessions per profile at `src/extension/native-history.ts:287–363`, preserving native IDs. `catchUp()` at `:201–224` reconciles terminal-written history before a rich-chat send and reports failure to synchronize.

An alternate legacy `continueChat` action remains. `src/application/sessions/session-manager.ts:106–140` stores the old native ID in `previousAgents`, replaces the active provider, and clears its native ID. The handler is at `src/extension/handlers/threads.ts:249–273`. Those historical IDs are preserved as metadata, but this path does not automatically restore the earlier provider session on switching back. Prefer the linked-thread flow consistently.

## 4. Official integration comparison

### 4.1 Claude options

| Approach | Native capabilities | Operational tradeoff | Recommendation |
| --- | --- | --- | --- |
| Agent SDK with installed unmodified binary | Native loop, sessions, streaming, tool callbacks, hooks, MCP, skills, and subagents | Best fit for interactive TypeScript controls; SDK/CLI compatibility and commercial terms need management | Retain technically, conditional on resolving public subscription integration permission |
| CLI `claude -p` with structured output | Native harness and resumable sessions; JSON/stream JSON output | Less convenient structured callback integration; more protocol work belongs to Claudex | Useful documented automation option; not a demonstrated policy workaround |
| Interactive CLI in native terminal | Native UI, sign-in, permissions, and provider-specific features | Less rich integration with Claudex UI | Preserve as a supported fallback and native execution surface |
| Direct Anthropic API/Client SDK | Model access; application must supply agent behavior | Requires different billing/authentication and more agent implementation | Reject for this objective |

Anthropic documents the Agent SDK as a library that runs Claude Code's binary and agent loop. Skills, hooks, MCP, native subagents, and sessions are capabilities of that harness. The SDK overview also expressly restricts third-party subscription-login offerings without approval. [Official Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).

`claude -p` is described as Agent SDK execution through the CLI. JSON streaming is documented, including partial output. Replacing an SDK import with a subprocess does not establish a different permitted authentication category. [Programmatic execution](https://code.claude.com/docs/en/headless).

The TypeScript reference documents `pathToClaudeCodeExecutable`, default native runtime resolution, persistent sessions, and feature-specific minimum CLI versions. In particular, per-tool MCP permission policies require Claude Code **2.1.301+**; older executables can ignore that list. [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript).

### 4.2 Codex options

| Approach | Native capabilities | Operational tradeoff | Recommendation |
| --- | --- | --- | --- |
| `codex app-server` over stdio | Bidirectional rich-client protocol, native thread/turn lifecycle, events, approvals, account/history operations | More protocol maintenance; experimental fields require compatibility checks | Keep for interactive extension integration |
| `@openai/codex-sdk` | High-level local thread creation, streaming, and resume | Simpler automation API; not equivalent to app-server's interactive client surface | Use only if a later automation feature specifically needs it |
| `codex exec` | Native harness and structured automation output | Less suitable for an interactive approval-driven client | Appropriate for scripts/CI, not a replacement for current rich chat |
| Interactive CLI | Full native user interface and configuration | Limited embedding | Preserve terminal resume/fallback |
| Direct OpenAI model API | Model access rather than Codex harness | Different auth/billing and application-owned loop | Reject for this objective |

OpenAI recommends app-server for rich clients and the SDK for automation. App-server supports native start/resume, turns, streamed items, approvals, account state, skills, and MCP-related operations. Use stdio; do not introduce a network listener for this extension. Version-test experimental surfaces. [App-server documentation](https://learn.chatgpt.com/docs/app-server), [SDK documentation](https://learn.chatgpt.com/docs/codex-sdk).

The current upstream TypeScript implementation wraps `codex exec --experimental-json`; it spawns a subprocess and streams JSON, with `Thread` managing the saved thread ID. It does not eliminate a native runtime or supply the same bidirectional approval interface. These are upstream-main observations, not a promise about every published SDK version. [Exec implementation](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts), [Thread implementation](https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts).

Codex source is Apache-2.0 licensed. Binary redistribution still requires release-specific notices and review of the complete artifact; software licensing does not grant unrestricted subscription authentication. [Codex license](https://github.com/openai/codex/blob/main/LICENSE).

### 4.3 Runtime overhead and maintenance

Neither SDK should be assumed to avoid process startup. Today Claude starts a query for each turn; Codex keeps an adapter-owned app-server connection. Model and skill catalog reads create additional short-lived processes: `src/application/catalogs/model-catalog.ts:12–96` and `src/application/catalogs/skill-catalog.ts:65–119`.

Preserve this simple architecture until measured startup/memory data justify consolidation. An unconditional shared server per profile would add multiplexing, failure-domain, configuration, and ownership complexity. Catalog caching and connection reuse can be considered after correctness gates pass.

## 5. Subscription compliance and billing

### 5.1 Claude: distinguish billing behavior from distribution permission

Three current official statements must be read together:

1. The SDK overview requires prior approval for third-party developers offering claude.ai login or subscription rate limits in their products. It points developers to API authentication.
2. The subscription support article, updated **October 7, 2026**, says plan-authenticated SDK and `claude -p` usage still draws from subscription limits. Its June 15 update paused previously announced changes and mentions third-party application usage. Linked Console API credits are a separate route.
3. The legal page expressly allows an end user to sign into an **unmodified Claude Code binary** inside a product under its stated commercial conditions. It prohibits credential intermediation, reselling usage, binary modification, and restricting built-in authentication methods.

Sources: [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [subscription support update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

**Conclusion:** native subscription use has a documented permitted category, but these pages do not unambiguously authorize Claudex's exact public SDK-driven embedded-chat offering. Obtain provider confirmation covering the architecture, distribution model, bundled SDK, and marketing claim. Do not interpret successful personal use as public product approval. Do not treat `-p` as a loophole.

The SDK is governed by Anthropic's Commercial Terms rather than Claudex's MIT license. `THIRD_PARTY_NOTICES.md:13` already identifies this distinction. Review redistribution and branding, including the name and provider marks, before release; this audit does not determine trademark compliance.

### 5.2 Codex: local and commercial categories differ

The current app-server documentation permits continued app-server authentication for local or open-source applications and excludes commercial or hosted services. It recommends the newer Sign in with ChatGPT route. [App-server authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints).

The newer route documents ChatGPT-plan authorization for open-source/locally hosted applications; paid or remotely hosted applications are directed to an interest process. It requires an application-owned OAuth lifecycle. Its app-server recipe passes an authorized access token to the child and requires the host application to refresh it. [Sign in with ChatGPT overview](https://developers.openai.com/siwc/token-sharing-open-source), [app-server recipe](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

That token-management approach conflicts with the current repository instruction to leave credentials inside native tools. Do not implement it as part of routine hardening. For the present local extension, preserve native authentication only within the documented permitted category. If Claudex becomes a commercial offering or its classification is uncertain, obtain clarification before launch. The private repository and an MIT license declaration alone do not establish that it is publicly open source.

The newer route also has preview capability limits. Local shell/MCP tools, child agents, local history, and resume can work, but it does not offer every hosted Responses capability. Changing authentication routes would require another capability audit. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

### 5.3 Effective authentication can differ from native login

Claude documents credential precedence that includes cloud modes, bearer tokens, API keys, and `apiKeyHelper` before normal saved subscription login. In noninteractive execution, `ANTHROPIC_API_KEY` is used when present. Console OAuth is not synonymous with subscription authentication. [Claude authentication](https://code.claude.com/docs/en/authentication#authentication-precedence).

Use the documented nonsecret `claude auth status` JSON from the same executable, profile, cwd, and environment as execution. It reports `authMethod`; `configDirectory` requires CLI 2.1.268+. Do not use `auth login --console` for subscription onboarding. [CLI reference](https://code.claude.com/docs/en/cli-reference).

Codex supports both ChatGPT and API-key authentication, shared cached credentials, custom providers, and organization-controlled configuration. Credentials may reside in native files or the OS credential store; the runtime owns refresh. Query account metadata and effective provider configuration rather than reading tokens. [Codex authentication](https://learn.chatgpt.com/docs/auth).

**Subscription authentication also does not guarantee zero additional spending.** Claude usage credits can automatically continue requests at consumption-based rates once included limits are exhausted. Codex also has credit-based usage options. Provider-side billing settings and account policy must be considered separately from API-key detection. [Claude usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans), [Codex pricing](https://learn.chatgpt.com/docs/pricing).

### 5.4 Recommended safe strategy

- Let the installed native runtime perform login, token storage, refresh, and organization-policy enforcement.
- Before model work, inspect supported nonsecret status and effective configuration using the exact execution context. Detect credential override presence without logging values.
- Report `subscription verified`, `API/cloud credentials detected`, `sign-in required`, or `unknown`; include profile and verification time. Do not label a profile subscription-backed from installation or a successful model-list call.
- For Claudex's included-usage objective, refuse to initiate a rich-chat turn if its billing route cannot be established. Explain the conflicting configuration and let the user resolve it through native settings.
- Do not silently delete credentials, override managed configuration, alter built-in authentication choices, or retry with API billing. A launch preflight must not modify the provider's authentication system.
- On expiration, preserve state and offer native reauthentication. On limits, report the provider response and reset information; do not automatically purchase credits, reset limits, change model/provider, or start another account.
- Where no authoritative included-only enforcement exists, state that limitation. Account-level overage settings must be disabled or constrained through the provider; sparse UI usage meters are not a spending firewall.

**Cannot currently be guaranteed for a public extension:** permission for the exact Claude SDK subscription offering; commercial Codex subscription authentication without an approved route; availability across every account/organization; or zero extra spending solely from detecting subscription login.

## 6. Gap analysis

Effort: S = small, M = medium, L = large. Fix risk describes implementation/regression risk. High confidence means the code or documentation establishes the finding; it does not imply the adverse scenario was reproduced.

| Priority | Finding/status | Evidence | Impact | Effort / fix risk / confidence |
| --- | --- | --- | --- | --- |
| P0 | Public subscription-distribution category unresolved | Official sources in section 5; bundled SDK in `scripts/build.mjs:50–59` | Cannot make an unconditional public compliance promise | M / medium / high that clarification is needed |
| P0 | Effective auth/billing gate missing | `process.ts:29–33`; Claude adapter `:206–224`; onboarding `:5–9` | API/cloud billing can be selected despite a subscription login | M–L / medium / high |
| P0 | Runtime compatibility gate missing | `launcher.ts:87–117` treats successful version output as ready | Unsupported protocol or ignored permission fields can affect behavior | M / medium / high |
| P1 | Windows discovery/launch partial | `agent-paths.ts:15–22`; direct `spawn`/`execFile` | Default names can miss `.exe`/`.cmd` installations | M / medium / high |
| P1 | Checkout/native-session ownership missing | `turn-lifecycle.ts:73–78`; `session-delegation.ts:35–44` | Independent agents can write the same checkout concurrently | M–L / medium / high for missing guard |
| P1 | Terminal ownership lost on reload | `controller.ts:85,592–597`; terminal handler `:59–61`; persisted schema excludes `inTerminal` | A surviving terminal may share a native session with resumed rich chat | M / medium / high for lost mapping; live consequence unverified |
| P1 | Cross-instance persistence coordination missing | `session-persistence.ts:86–107` | Active writers can overwrite snapshots or contend for one temp filename | M / medium / high |
| P1 | Descendant shutdown unverified | `process.ts:90–98` signals direct child only | Provider/tool/MCP descendants may survive abnormal shutdown | M–L / high / medium for consequence |
| P1 | Complete native capability support partial | Codex adapter `:646–714`; capability model `:8–29` | Some native requests require terminal fallback | M / medium / high |
| P2 | Legacy switching differs from primary flow | `session-manager.ts:106–140`; threads handler `:249–273` | Switching via alternate action starts new native sessions | S–M / low–medium / high |
| P2 | Handoff lacks a structured repository/evidence snapshot | `session-packet.ts:106–176`; documents template `:34–45` | Decisions, Git baseline, test provenance, and next actions rely on prose history | M / low / high |
| P2 | Native history multi-root scope partial | `native-history.ts:289,335` selects first folder | History may not reflect the user's selected project | S–M / low / high |
| P2 | Documentation and implementation diverge | `docs/verification.md` versus native-history and surfaces code | Readers can mistake old limits/evidence for current behavior | S / low / high |

### Safety-relevant compatibility detail

The Claude delegation server relies on `tools: [{ permission_policy: 'always_ask' }]` at `src/providers/claude/adapter.ts:137–144`. Official documentation says an external CLI older than 2.1.301 can ignore that policy. If its existing settings otherwise allow the MCP tool, the intended per-call approval cannot be presumed. Gate this feature on a verified runtime capability/version; do not claim approval preservation for arbitrary Claude versions. The risk is conditional; it was not reproduced with an old CLI during this audit.

### Working foundations to retain

- Native harness execution and exact native-ID resume.
- Schema validation of incoming webview actions at `src/extension/router.ts:41–57`, followed by trust checks for workspace actions.
- Per-session approval correlation and rejection of stale requests at `session-approvals.ts:25–59`.
- Rejection and disclosure of unsupported provider requests.
- Interrupted recovery without automatic task restart.
- Bounded, inspectable context handoff with no transferred approvals or hidden thinking.
- Profile failure without default-account fallback.
- Ordinary Markdown plans and documents.

Claude Ask currently means `dontAsk` plus disabled Edit/Write/NotebookEdit, not a filesystem sandbox: preapproved shell or MCP operations may remain possible. Codex Ask selects a read-only sandbox with network disabled. The capability descriptions already acknowledge the distinction at `src/shared/domain/capabilities.ts:15–28`. Keep that distinction visible on every relevant surface.

## 7. Cross-platform strategy

### 7.1 Compare installation models

| Model | Benefits | Costs and restrictions | Decision |
| --- | --- | --- | --- |
| A. Installed binaries only | Native updates/authentication; small VSIX; less supply-chain responsibility | PATH/setup/version variability; users install tools on each execution host | Suitable foundation, insufficient guidance alone |
| B. Extension-managed runtimes | Potentially reproducible versions and discovery | Multi-platform payloads, signatures, updates, rollback, licenses, storage, organization policy; does not solve auth permission | Defer |
| C. Discovery-first hybrid | Existing installs work; guided setup; tested compatibility; optional approved components later | Requires a small runtime manager and truthful diagnostics | Recommended |

Claude's legal documentation describes conditional use/preinstallation of its unmodified binary, not an unrestricted open-source redistribution grant. Codex's Apache license does not remove service/authentication restrictions. Review exact artifacts and terms before adding managed downloads.

### 7.2 Runtime and architecture requirements

Separate four runtimes: the VS Code extension host, the provider binary, optional package-manager launchers, and tools/MCP servers the provider invokes.

- Claudex's bundle targets Node 20. Its SDK requires Node 18.14+. Test the declared minimum VS Code's actual extension-host Node/ESM behavior; installing a newer system Node does not upgrade that host.
- Claude's current native setup supports macOS 13+, Windows 10 1809+/Server 2019+, and documented Linux distributions on x64/ARM64. Native installation does not require Node; its current npm installation requires Node 22+. Linux musl has additional dependencies. These provider facts do not certify Claudex. [Claude setup](https://code.claude.com/docs/en/setup).
- Codex upstream runtime resolution names Darwin, Linux-musl, and Windows native targets for x64/ARM64. Verify the selected release's complete assets and companions, not just one executable. The npm wrapper and TypeScript SDK have separate Node requirements. [Upstream runtime resolution](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts), [npm wrapper metadata](https://github.com/openai/codex/blob/main/codex-cli/package.json), [SDK requirements](https://learn.chatgpt.com/docs/codex-sdk).
- Git/worktree features need Git. Skills, shell tools, and MCP servers may introduce additional user-installed runtimes. Show those failures separately from a missing provider.

### 7.3 Discovery and launch

`findExecutable()` currently searches PATH, `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`, checking existence only. It does not expand Windows executable suffixes, prove executable permissions, or classify npm launchers.

Recommended resolution order: explicit user/profile path, execution-host PATH, documented provider install directories, then guided selection. Resolve to an absolute path; report origin, architecture, version, and execution host. Reject directories and explain permission/architecture failures.

Desktop-launched VS Code can have a different PATH from an interactive shell. Support official install locations and explicit paths rather than automatically executing arbitrary login-shell startup scripts. Refresh discovery after installation and explain when a host/window restart is needed.

On Windows, distinguish `.exe` from `.cmd`/`.bat` wrappers. Prefer documented native executables. Where wrapper support is necessary, implement and test a narrowly scoped launch strategy preserving argument boundaries; do not apply `shell: true` broadly. Node documents that batch files cannot be launched with `execFile()` as ordinary executables. [Node child-process documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).

Test paths with spaces, Unicode, metacharacters, UNC paths, drive-letter differences, and mixed-case environment keys. Build scripts also need Windows treatment: `scripts/build.mjs:44–47` directly executes a Unix-style Tailwind launcher, and `scripts/package.mjs:6–17` directly executes `vsce`. Build portability and installed-VSIX portability are separate claims.

### 7.4 OS behavior and remote development

- **macOS:** test Finder/Dock launch, Intel and Apple Silicon, provider signatures/permissions, Homebrew and native installs. Do not bypass Gatekeeper or rewrite quarantine attributes automatically.
- **Windows:** test native processes, PowerShell/CMD login, npm wrappers, native sandbox requirements, and owned descendant termination. POSIX signals are not a portable shutdown contract.
- **Linux:** distinguish glibc and musl, required libraries, executable bits, sandbox/container restrictions, and headless browser authentication. Binary availability does not prove sandbox functionality.
- **Remote SSH, WSL2, Dev Containers:** execute the provider in the workspace extension host beside the repository. Runtime, home, credentials, skills, MCP configuration, and session files belong to that host. Do not automatically copy local credentials or map Windows paths into Linux sessions.
- **Web-only VS Code:** this Node/process implementation has no browser-only execution support.

Declare workspace-host placement deliberately and verify it. VS Code documents that workspace extensions and their child processes run where the workspace resides. [Extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host), [remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions).

Current `chooseWorkspace()` accepts only `file` scheme folders at `src/extension/handlers/threads.ts:89–95`. Remote behavior must be checked against the URI/host context actually exposed by VS Code; neither universal remote support nor universal incompatibility is established here.

### 7.5 Compatibility, updates, and recovery

Introduce a small runtime manager that records resolution and probes documented non-model capabilities. Maintain tested version ranges and distinguish missing, incompatible, unauthenticated, unsupported-platform, and degraded-capability states. Optional unavailable features should disappear or explain their limitation; safety-critical incompatibility should block execution.

Respect provider/package-manager/organization update ownership. Offer an explicit update action or official instructions; do not silently upgrade a running user installation or pin it by overriding managed policy. Reprobe after updates and revalidate the auth mode.

On disconnect or crash, preserve exact native IDs, cwd, profile/home identity, and last known state. Never treat an exit code, checkbox, or missing process handle as task completion. Resume only following an explicit user action. If the native session is missing or belongs to another runtime home, explain that and offer a clearly labeled fresh-session context handoff rather than silently replacing it.

## 8. Recommended smallest robust architecture

Keep the present layers and add focused responsibilities rather than a generic agent framework:

| Component | Responsibility |
| --- | --- |
| Runtime manager in the extension/host layer | Resolve and validate binary, host OS/architecture, launch strategy, version, compatibility, and installation diagnostics |
| Provider adapters under `src/providers` | Own native protocol/auth-status interpretation, events, permissions, interrupts, and capability probes |
| Session application layer | Maintain local/native identities, ownership, lifecycle, handoff links/cursors, and truthful recovery |
| Persistence | Coordinate store writes and preserve recoverable backups/conflicts |
| Webview | Render supported capabilities and send schema-validated actions; no Node/VS Code APIs or credentials |

Use a small capability descriptor including auth verification, resume, approvals/questions/elicitation, modes, skills, MCP status, and interruption confirmation. Preserve provider-specific semantics. The current mode/skill-toggle abstraction is too narrow to advertise complete native parity.

Keep unsupported requests rejected. Add handlers only against documented, version-tested schemas. Do not add a permissive generic approval handler for unknown request types.

Keep existing custom delegation user-directed or explicitly approved. `turn-lifecycle.ts:103–106` prevents a delegated child from creating another application delegate; retain that no-loop property. Prefer native subagents for native work and explicit cross-provider delegation only where needed.

## 9. Session continuity and portable handoff contract

### 9.1 Continuity rules

| Transition | Required behavior |
| --- | --- |
| Claude → Claude | Resume exact native session ID under the same verified profile/runtime home; preserve native history |
| Codex → Codex | Resume exact native thread ID; create a new turn only after explicit Send |
| Claude → Codex | Create or reuse a linked Codex thread and attach a context record; retain original Claude ID |
| Codex → Claude | Create or reuse a linked Claude session and attach a context record; retain original Codex ID |

Cross-provider continuation is an exchange of task context. It does not import the other harness's internal state, permissions, tool handles, token cache, or model reasoning. Native provider migration features, where available, should be treated as separate explicit operations rather than assumed by this contract.

Native identity should be keyed by provider, profile/runtime-home identity, execution host, and native ID. Persist runtime version and canonical cwd alongside it for diagnosis. Keep linked sessions separate and retain legacy `previousAgents` metadata during any migration.

### 9.2 Proposed Markdown contract

Extend the existing packet builder and ordinary Markdown documents. Do not require an opaque model-generated database record.

```markdown
# Task handoff

Contract version: 1
Task/link ID: ...
Created at: ...
Source provider/profile/native session: ...
Execution host and checkout: ...
Source state: completed | failed | interrupted | idle
Source cursor / through-message: ...
Omitted or truncated evidence: ...

## Goal and user constraints
## Decisions and rationale
## Repository state
Git HEAD, branch, worktree, dirty paths, and diff summary;
identify untracked files and user changes without claiming authorship.
## Relevant files and documents
## Verified work and evidence
## Test results
Command, cwd, timestamp, exit/result, scope, and remaining limits.
## Unresolved questions and blockers
## Next actions and acceptance criteria
```

Record provenance: user instruction, provider report, tool result, or filesystem observation. A successful test command establishes only its actual scope. An agent summary or checked task does not establish completion. Escape/truncate untrusted source content and disclose omissions. Do not copy hidden reasoning, approvals, credentials, or provider home contents.

The recipient should inspect current repository state before editing. Resume preserves conversation, not filesystem snapshots. Worktrees created from committed HEAD do not automatically contain dirty changes; the current implementation already warns about this at `src/extension/handlers/threads.ts:240–244`.

### 9.3 Prevent conflicting writes

Introduce native-session ownership and canonical-checkout write ownership, with explicit allowance for read-only concurrency and isolated worktrees. Scope coordination across extension instances where they can reach the same checkout/session.

At handoff: wait for confirmed stop/settlement, capture current Git state, transfer write ownership, then allow the target to start. If stopping is uncertain, retain an unresolved ownership marker rather than assuming the checkout is free. Do not resume the original writer until ownership is returned.

Application delegates currently inherit `parent.cwd`; do not silently impose a lock that deadlocks parent/child calls. Define delegation ownership transfer or use an explicitly isolated worktree. External terminals and tools cannot be fully controlled by Claudex; disclose that limit and require reconciliation when ownership cannot be established.

## 10. Prioritized implementation milestones

All milestones below are proposals for review. After approval, preserve pnpm 10.33.2 and the lockfile, keep adapters under `src/providers`, and run `pnpm check` for code changes. No milestone authorizes smoke tests without separate live-testing authorization.

### M0 — Resolve release permission and support claims

Scope: distribution decision, authentication boundaries, SDK notices, branding, and user-facing claims. No provider integration rewrite.

Acceptance criteria:

- Record the intended free/local/open-source/commercial/hosted classification.
- Obtain or document authoritative applicability for the exact Claude SDK subscription architecture; unresolved claims stay explicitly unresolved.
- Establish the permitted Codex authentication category without introducing application-owned credentials.
- Review exact redistributed packages and notices.
- Define a support matrix that distinguishes provider documentation from Claudex-tested support.

Dependencies: none. Effort M; implementation risk low, external timing unknown.

### M1 — Add authentication and compatibility preflight

Scope: provider status interpretation, runtime metadata, capability checks, onboarding, and launch gates. Likely files: `src/providers/*`, `src/extension/launcher.ts`, `src/extension/agent-paths.ts`, and shared status/capability types.

Acceptance criteria:

- The same executable/profile/environment is checked and executed.
- Unknown/API/cloud modes cannot silently start a turn represented as included subscription usage.
- No credentials are printed, copied, stored by Claudex, or removed automatically.
- Claude delegation approval policy is exposed only with a verified compatible runtime; simulate older runtimes ignoring fields.
- Optional experimental usage failures do not imply auth success or fabricated limits.
- Effective mode changes/expiration are surfaced without API fallback or automatic paid continuation.
- Fixture tests cover account/config conflicts, missing metadata, managed policy, and safe refusal before turn start; `pnpm check` passes.

Dependencies: M0 for release claims. Effort M–L; risk medium.

### M2 — Complete portable runtime discovery and launch

Scope: host-specific discovery and spawn strategy, setup guidance, and build launcher portability.

Acceptance criteria:

- Native and supported npm installations are discovered on tested OS/architecture cells.
- Paths with spaces/Unicode/metacharacters preserve argument boundaries.
- Missing, nonexecutable, wrong-architecture, and unsupported-version states have distinct actionable errors.
- GUI PATH differences and remote-host installation are explained.
- No broad shell execution, automatic credential transfer, or silent runtime installation is introduced.
- Fresh VSIX tests establish behavior independently of the development checkout.
- `pnpm check` and relevant cross-platform fixture tests pass.

Dependencies: M1 runtime descriptor. Effort M; risk medium.

### M3 — Harden ownership, persistence, and shutdown

Scope: turn lifecycle, terminals, checkout/native-session ownership, persistence coordination, and crash recovery.

Acceptance criteria:

- Two active instances cannot silently overwrite the same session store; unique temporary files alone are not considered sufficient conflict control.
- The same native session cannot be concurrently driven by rich chat and an owned native terminal after reload.
- Two ordinary writers cannot concurrently own the same checkout; read-only/worktree/delegation behavior is explicitly defined.
- Stop timeout leaves truthful failed/uncertain state and preserves native identity.
- OS-level tests show what happens to owned command/MCP descendants after stop, reload, crash, and forced termination.
- No unrelated processes are terminated; recovery never restarts work automatically.
- Regression tests include two actively mutated persistence instances and reload with a surviving terminal; `pnpm check` passes.

Dependencies: M1–M2. Effort L; risk medium–high.

### M4 — Unify continuation and enrich evidence

Scope: existing linked-thread flow, legacy continuation, packet builder, Markdown handoff templates, and multi-root history scope.

Acceptance criteria:

- Switching both directions preserves each original provider ID and resumes it when returning.
- All supported controls have consistent linked-session behavior; legacy records remain readable.
- Handoff includes the versioned sections in section 9, evidence provenance, Git snapshot, and truncation metadata.
- A rejected delivery does not advance the sync cursor; accepted context is not labeled completed work.
- No approvals or hidden reasoning transfer.
- Dirty-worktree differences and selected workspace scope are visible.
- Existing continuation/packet tests and `pnpm check` pass; UI tests verify preview/removal/no-send-on-switch.

Dependencies: M3 ownership contract. Effort M; risk medium.

### M5 — Certify capability coverage and package release

Scope: typed/versioned native request support, packaged-extension tests, platform evidence, and corrected documentation.

Acceptance criteria:

- Supported and unsupported permission/elicitation types are explicitly listed per provider/version.
- Unknown requests remain rejected without grants.
- Real VS Code tests cover webview routing, terminals, plan/doc opening, and recovery.
- Authorized live tests establish native resume and both handoff directions on advertised platforms.
- Release evidence records exact extension, SDK, CLI, OS, CPU, execution host, and authentication category without secrets.
- Documentation matches current behavior; packaging contains required notices/assets and no credentials.
- `pnpm check`, `pnpm test:ui`, and `pnpm package` pass in the release workflow. Live smoke commands run only with authorization.

Dependencies: M0–M4. Effort M–L; risk medium.

## 11. Reproducible verification plan

### 11.1 Environment matrix

The following is a target test matrix, not a claim that the cells pass today. Test each provider only where the selected official release supports that environment.

| Environment | Architectures | Required variations |
| --- | --- | --- |
| macOS | ARM64 and x64 | Native install, Homebrew, existing install, GUI-launched VS Code, explicit path |
| Windows native | x64; ARM64 where release-supported | Native install, npm launcher, PowerShell/CMD, spaces/Unicode path, sandbox setup |
| Linux glibc | x64 and ARM64 | Supported Ubuntu/Debian versions, desktop and headless, installed tools and missing libraries |
| Linux musl | x64 and ARM64 where release-supported | Alpine, provider dependencies, search tooling, sandbox restrictions |
| WSL2 | Supported Linux host architecture | Provider installed/authenticated inside WSL, Windows filesystem path boundary |
| Remote SSH | Linux x64/ARM64 | Remote-only provider, remote home, browser/device login behavior, disconnect/reconnect |
| Dev Container | x64/ARM64 where supported | Fresh image, persisted versus ephemeral home, container rebuild, sandbox constraints |
| VS Code runtime | Minimum declared version and current stable | Actual extension-host Node version, SDK ESM import from packaged dist, reload/upgrade |
| Browser-only/virtual workspace | No Node process host | Explicit unsupported state; no attempted execution |

For each supported cell, record: OS/build, CPU, VS Code and embedded Node, extension version/VSIX hash, provider and SDK versions, installation origin, resolved executable, remote/local execution location, nonsecret auth category, and test outcome.

### 11.2 Automated tests without model calls

Use fixtures/fake processes for protocol behavior; temporary repositories for filesystem behavior. Extend existing provider/session tests rather than creating a second harness.

- Discovery: executable suffixes, install directories, PATH delimiters/casing, permissions, spaces/Unicode, missing/unsupported architecture.
- Compatibility: old/new runtime schemas, ignored optional fields, unknown RPC methods, experimental capability denial, malformed responses, initialization timeout.
- Authentication: subscription/API/cloud/unknown status, environment/helper overrides, config/account changes, expiration, missing status methods, organization restrictions; assert that blocked states send no model turn.
- Approvals: command/file/question requests, concurrent requests, cancellation, stale/replayed IDs, denied tools, unsupported permission/elicitation requests, no automatic grants.
- Lifecycle: matching turn completion, interrupted/failed distinction, transport exit, partial JSON, unconfirmed stop, stale event generations, stream ending without native result.
- Persistence: two actively changed instances, failed rename/write, unreadable state, backup preservation, crash between native-ID receipt and checkpoint, no automatic restart.
- Continuity: same-provider resume, both handoff directions, linked thread reuse, failed delivery cursor, empty delta, truncation, untrusted content, profile/home changes.
- Ownership: concurrent sends, same native ID through different local records, same checkout through symlinks/case variations, parent/child delegation, surviving terminal after reload.
- Boundary: retain architecture tests and Zod webview action validation; test untrusted workspace refusals and path/symlink escapes.

Gate approved code changes with `pnpm check`. Use `pnpm test:ui` for browser UI behavior, understanding that it does not validate VS Code terminal/process APIs. Package tests must import the SDK from the produced VSIX layout.

### 11.3 Manual and authorized live experiments

1. **Fresh install:** install the VSIX in a clean VS Code profile with no providers. Verify setup guidance, no execution, and no automatic download. Install one provider through its official workflow, refresh discovery, and authenticate natively.
2. **Authentication conflict:** with controlled test credentials/configuration, introduce an API-key/helper/cloud override while a subscription login exists. Verify that the preflight identifies the effective route and blocks an included-usage turn. Never log the secret.
3. **Subscription evidence:** use a minimal authorized turn under a known plan, inspect provider-reported mode/usage and the provider dashboard. Dashboard evidence supports that account/time; it is not a universal entitlement or legal guarantee.
4. **Expiration and limits:** use revoked/expired test login and a limit response. Verify preserved sessions, native reauthentication guidance, truthful limits, and no silent API/account/credit fallback. Paid-overage tests require explicit cost authorization.
5. **Tools and permissions:** perform a harmless read, controlled edit, denied command, question, native skill, hook, MCP operation, and native subagent. Verify provider policy and UI behavior, including unsupported requests.
6. **Resume:** save a unique marker, close provider/VS Code, reopen, confirm interrupted state if needed, and explicitly resume the same native ID. Verify that the native CLI can resume it too.
7. **Handoff:** Claude → Codex → original Claude, and Codex → Claude → original Codex. Confirm distinct retained native IDs, task evidence transfer, delta behavior, and no conflicting writers.
8. **Shutdown:** interrupt during streaming, a shell command, an approval, and an MCP operation. Reload/crash the extension host; inspect owned descendants and native history. Record uncertain termination rather than asserting success.
9. **Terminal reload:** open a native session in a terminal, reload while it remains alive, then try rich-chat resume. Confirm ownership recovery or an explicit unresolved-owner block.
10. **Remote:** repeat installation, login, resume, and tool tests inside SSH/WSL/container hosts. Confirm that executable, cwd, credentials, and native session storage refer to the same host.

`pnpm smoke` and `pnpm smoke:delegate` make real calls and consume normal quota. Do not run them as routine audit or packaging checks.

### 11.4 Existing evidence and its limits

`docs/verification.md` records prior Apple Silicon macOS testing with Claude Code **2.1.318** and Codex **0.166.0**, including native resume and cross-provider recall. It also records automated and UI runs. These are repository-recorded results, not newly reproduced results from this audit, and do not certify Windows/Linux/remote support or every authentication mode.

Some older statements are stale: the document says arbitrary native history is not imported and terminal messages are not backfilled, while current `native-history.ts` implements listing/opening and catch-up. It also describes a no-inline-style CSP, whereas `src/extension/surfaces.ts:130` currently allows inline styles. Reconcile these statements as part of release evidence; do not present historical checks as current blanket certification.

## 12. Review decisions required before implementation

- Confirm the intended distribution/business category and resolve provider authentication applicability.
- Approve discovery-first hybrid runtime management, initially without managed binaries or application-owned OAuth.
- Decide the product wording and enforcement limits for included subscription usage versus provider-enabled paid overage.
- Approve native-session/checkout ownership semantics, especially delegates and surviving terminals.
- Select the initial support cells to certify; retain explicit unverified labels elsewhere.

Implementation should begin only after review of this plan. No source refactor, dependency installation, provider runtime change, or publication was performed for this report.
