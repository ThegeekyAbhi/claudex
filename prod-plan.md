# Claudex — Production Architecture, Native Agent Integrations & Engineering Workflow Platform

You are acting as a Principal Software Engineer, SDK Integration Architect, and technical product architect.

Your responsibility is to thoroughly inspect our existing Claudex repository, research the latest official provider documentation, challenge architectural assumptions, and produce a practical, evidence-backed plan to evolve Claudex into a reliable, production-grade VS Code extension.

Think like the engineer responsible for maintaining this product for years, supporting thousands of installations across different operating systems and provider runtime versions.

**This is PLAN MODE. Do not implement features, refactor source code, update dependencies, install tools, or launch live agent sessions.**

You may create or update a clearly identified planning document inside the repository, preserving unrelated content.

---

# 1. Product vision

Claudex is a unified engineering workspace built around native coding agents.

We want developers to work with Claude Code and OpenAI Codex through a polished IDE experience without losing the power of their native harnesses.

Our goal is not to build another chat interface or a replacement agent framework.

Our goal is to build an engineering control plane that makes software development:

- Faster without sacrificing correctness.
- Easier to plan, implement, test, debug and review.
- More reliable through independent verification and evidence.
- Better organized across multiple agent sessions.
- Consistent across operating systems.
- Resilient to SDK, CLI, protocol and model updates.
- Extensible through tools, MCP, skills, workflows and automations.

The user should be able to open a repository, understand what needs attention, select a task, assign an agent, supervise progress, inspect changes, run tests, request an independent review and confidently decide whether the work is ready.

The experience should feel like an integrated engineering workspace, not several disconnected agent terminals.

# 2. Existing architecture: preserve before replacing

We already completed an integration audit dated November 8, 2026.

Historical audit baseline:

- Repository commit: `5f48a42`
- Manifest version: `0.8.8`
- Existing working-tree changes were present during the audit.
- Claude SDK: `@anthropic-ai/claude-agent-sdk` version `0.3.318`
- Codex: native `codex app-server` over stdio.
- The project already has working provider adapters, native session IDs, streaming, permissions, delegated agents, persistence and cross-provider handoff mechanisms.

These observations are historical, not a replacement for inspecting the current working tree.

Read the provided **Claudex production integration audit and implementation plan** in full. Locate the report in the repository if present; otherwise use the attached report as the baseline.

Inspect the existing project, particularly:

- `src/providers`
- `src/providers/claude/adapter.ts`
- `src/providers/codex/adapter.ts`
- `src/providers/process.ts`
- `src/application`
- `src/application/sessions`
- `src/shared`
- `src/infrastructure`
- `src/extension`
- `src/webview`
- `tests`
- `scripts/build.mjs`
- `scripts/package.mjs`
- `package.json`
- `docs/verification.md`

Identify all existing implementations before proposing new abstractions.

### Important design principle

**Prefer improving the existing architecture over rebuilding it.**

Every proposed abstraction must have a concrete reason to exist.

Do not recommend switching Codex from App Server to the Codex SDK simply because Claude uses an SDK.

We want the best official native integration for each provider, not artificial uniformity.

Do not confuse the OpenAI Agents SDK or hosted Agents API with the Codex SDK or Codex App Server. Our current objective requires native Codex harness execution, not an API-billed replacement.

---

# 3. Research the latest native agent interfaces

Use current official documentation, release notes, changelogs, SDK references and relevant upstream implementations.

Research both providers independently.

## 3.1 Claude Code integration

Study:

- Claude Agent SDK TypeScript API
- Native Claude Code executable integration
- SDK and executable version compatibility
- Session creation and resumption
- Streaming and structured events
- Permission callbacks
- Tool approval and cancellation
- SDK MCP servers and external MCP servers
- Custom tools
- Skills and plugins
- Hooks
- Native subagents and worker events
- Plan and execution modes
- Context management and compaction
- Runtime shutdown and recovery
- Authentication precedence and subscription usage
- Restrictions on third-party SDK integrations and public distribution

Determine whether our existing adapter uses supported interfaces correctly.

Identify features available upstream that Claudex currently does not expose.

Separate stable APIs, experimental APIs, undocumented behavior and assumptions.

## 3.2 Codex integration

Study:

- Codex App Server protocol
- Codex SDK and CLI
- Thread and turn lifecycle
- Structured streaming events
- Approval and elicitation requests
- Skills, hooks, plugins and MCP support
- Native subagents
- Dynamic/custom tool capabilities
- Sandbox and execution policies
- Thread resume and state persistence
- Authentication, account state and usage limits
- App Server protocol/schema generation
- Experimental protocol changes and version compatibility

Determine how to maintain a robust App Server adapter across multiple Codex versions.

Evaluate whether any Codex SDK capability would genuinely improve Claudex. If App Server is still preferable, explicitly justify retaining it.

### Research deliverable

Create a provider capability matrix:

| Capability | Claude | Codex | Claudex current | Gap | Stability | Recommendation |
|---|---|---|---|---|---|---|

Every important finding should reference a current official source and relevant repository code.

Sources to begin with:

- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/typescript
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/legal-and-compliance
- https://developers.openai.com/blog/codex-as-a-platform
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/codex-sdk
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

Prefer the current canonical documentation URL when a link has moved.

---

# 4. Design a resilient provider integration layer

We need a production-grade provider boundary that remains maintainable when Claude Code or Codex changes.

Evaluate our current abstractions and propose targeted improvements.

The architecture should distinguish:

1. Runtime discovery and compatibility.
2. Authentication and account status.
3. Native session lifecycle.
4. Messages and streamed events.
5. Tool execution visibility.
6. Permissions and user approvals.
7. Capabilities and provider-specific extensions.
8. Skills, hooks and MCP integrations.
9. Process ownership and shutdown.
10. Recovery and diagnostics.

Do not reduce provider-specific capabilities to the lowest common denominator.

Propose a shared contract for genuinely common behavior, while preserving provider-native extension points.

### Critical questions

- How should the host detect whether a capability is available?
- Should capabilities be determined by runtime version, active probing, schema inspection or a combination?
- How should unsupported features appear in the UI?
- How should we handle unknown or newly introduced protocol events?
- Which errors should recover automatically, and which require user intervention?
- How should feature flags and compatibility guards work?
- How do we avoid fragile dependencies on undocumented provider metadata?
- How do we preserve native tool permissions if the SDK or CLI behavior changes?
- How should adapters behave when the provider runtime is upgraded while Claudex is running?

Produce an interface-level design with event contracts, ownership boundaries and error semantics.

Do not implement a generic agent framework.

---

# 5. Build a future-proof SDK and runtime update strategy

This is one of our highest priorities.

Claude Code and Codex release frequently. Claudex must evolve alongside them without breaking existing installations or exposing users to unsafe incompatibilities.

Design an **Agent Compatibility & Update System**.

Research and propose the following.

## 5.1 Version and capability compatibility

Maintain a tested compatibility matrix for:

- Claudex extension versions
- Claude Agent SDK versions
- Claude Code executable versions
- Codex App Server versions
- Operating systems and CPU architectures
- Required native capabilities
- Optional experimental capabilities

Distinguish:

- Compatible and tested
- Compatible with degraded functionality
- Installed but unverified
- Known incompatible
- Unsupported

Never assume a newer version is automatically compatible.

## 5.2 Upstream change detection

Investigate how we can monitor:

- Claude SDK releases
- Claude Code CLI releases
- Codex CLI/App Server releases
- Official release notes and changelogs
- Protocol/schema changes
- Deprecated methods
- New tool and event types
- Security-related updates

Design a GitHub Actions or equivalent workflow that can periodically check provider releases and open a reviewable compatibility issue or dependency-update PR.

Do not propose blindly upgrading runtime dependencies in production.

No automated publication without successful verification and explicit release approval.

## 5.3 Protocol compatibility tests

Evaluate:

- Version-pinned event fixtures
- Contract tests
- Generated TypeScript protocol definitions
- Schema validation
- Tests against multiple supported provider versions
- Simulated future events
- Missing/deprecated fields
- Unknown approval types
- Handshake failures
- Unsupported experimental functionality

For Codex, investigate version-matched App Server schema generation.

For Claude, investigate compatibility between the pinned Agent SDK and external CLI versions.

## 5.4 Canary and regression validation

Propose a safe workflow:

New provider version discovered
→ compatibility check
→ automated contract tests
→ packaged-extension smoke checks
→ controlled live test, when authorized
→ release decision
→ compatibility matrix update.

A compatible release should not require unnecessary manual engineering work.

An incompatible release should not silently break the extension.

Explain what can be automatically verified without consuming model quota and what requires explicitly authorized live sessions.

## 5.5 User-facing compatibility UX

Design a tasteful, minimal Runtime Health interface showing:

- Installed provider
- Native executable path
- Detected version
- Authentication state
- Compatibility status
- Available capabilities
- Required action, if any

Avoid exposing complex internal details unnecessarily.

Propose how the extension should explain an unsupported version or missing capability without making the entire experience unusable.

---

# 6. Cross-agent workflows: Claudex's differentiating feature

We want Claude and Codex to collaborate on a single engineering task while remaining independent native agent sessions.

Our existing context handoff mechanism should be the foundation.

Do not replace it without explaining what is broken or fundamentally missing.

Research and design a **Cross-Agent Workflow Engine**.

## 6.1 Session continuity

Support:

- Claude → Claude resume
- Codex → Codex resume
- Claude → Codex handoff
- Codex → Claude handoff
- Returning to the original native session

Preserve native session IDs and provider-specific history.

Cross-provider continuation means transferring task context, evidence and repository state. It does not import hidden reasoning, approvals or internal provider state.

## 6.2 Structured handoff

Improve our existing handoff packet with:

- Task intent and acceptance criteria
- Original user instructions
- Decisions and rationale
- Relevant repository files
- Git baseline and diff
- Commands and tests already executed
- Actual outcomes and evidence
- Known failures
- Unresolved questions
- Remaining work
- Provider and session provenance
- Explicit assumptions and uncertainty

Avoid unnecessarily transferring huge transcripts.

Investigate incremental/delta handoff, token-efficient summarization, structured evidence and file references.

An agent must verify the actual repository state before acting on a handoff.

## 6.3 Workflow execution

Evaluate a small, explicit workflow state machine.

Example:

Research
→ Plan
→ Human approval
→ Implement
→ Test
→ Independent review
→ Human acceptance.

Individual stages can use Claude, Codex, deterministic local tools or an approved native subagent.

Do not assume every task requires both providers.

Evaluate whether workflows should be described with typed TypeScript definitions, a declarative schema or a hybrid.

Compare complexity, debuggability, portability and security before choosing.

## 6.4 Delegation and concurrency

Design:

- Scoped agent delegation
- Parent-child job relationships
- Maximum delegation depth
- Recursion prevention
- Time/usage budgets where measurable
- Cancellation propagation
- Permission scopes
- Git worktree isolation
- Single-writer ownership where required
- Cross-window and cross-process coordination
- Deterministic job status
- Crash recovery
- Human review checkpoints

Avoid agents recursively delegating without a stopping condition.

Do not allow two writers to unknowingly modify the same checkout.

## 6.5 Workflow visibility

Investigate a UI that shows:

- The current workflow
- Active stage
- Assigned provider/model
- Current agent status
- Native tool activity
- Files modified
- Test status
- Approvals waiting
- Handoffs
- Results and blockers

All statuses must come from actual events or verified observations, not speculative progress estimates.

Provide interaction/state diagrams and proposed UI surfaces, not production UI code.

---

# 7. Engineer-focused tools, skills and automations

We want Claudex to make everyday software engineering meaningfully easier.

Research a small, extensible developer workflow platform that complements native agent capabilities.

## 7.1 Tool and MCP management

Evaluate an integrated tool manager for:

- Discovering existing provider MCP configurations
- Enabling/disabling tools by provider or workspace
- Tool permissions and trusted sources
- Tool health and availability
- Local MCP servers
- Shared tools usable by Claude and Codex
- Configuration conflicts
- Version compatibility
- Installation and removal with explicit user approval

Avoid modifying provider configuration files unnecessarily.

Preserve provider-specific settings rather than flattening them into a fake universal format.

## 7.2 Skills and workflow catalog

Evaluate how Claudex can expose native Claude and Codex skills, including reusable engineering practices.

Possible examples:

- Create implementation plan
- Review changes
- Generate relevant tests
- Diagnose failing CI
- Analyze query performance
- Inspect dependency updates
- Explain an unfamiliar code path
- Prepare a small, reviewable refactor

Distinguish native provider skills from Claudex-owned multi-step workflows.

Do not create redundant implementations of features already provided natively.

## 7.3 Automation and triggers

Research support for:

- Manual triggers
- Git branch or commit events
- PR/CI events
- Test completion
- User-approved file-change triggers
- Scheduled checks
- Session completion hooks

Define which triggers work only while VS Code is running and which require an explicitly installed local helper or remote runner.

Do not imply that VS Code extensions reliably continue running after VS Code exits.

## 7.4 Recommend the smallest useful initial workflows

Compare these candidates:

1. Independent PR review
2. Change-aware test selection
3. CI failure investigation
4. Plan → implement → test → review
5. Cross-agent architecture review
6. Performance regression investigation

Rank them by user value, engineering complexity, trust requirements, runtime usage and ability to verify outcomes.

Select only one or two for the first meaningful milestone.

---

# 8. Make generated code measurably better

This must be a primary product requirement, not just a marketing claim.

Claudex should help developers produce correct, maintainable, tested changes.

Research and propose a **Code Quality & Verification Pipeline**.

## 8.1 Quality gates

Evaluate:

- Acceptance criteria before execution
- Scope-limited changes
- Type checking
- Linting
- Targeted tests
- Integration tests
- Diff inspection
- Security-sensitive change detection
- Independent agent review
- Final human acceptance

Explain how to support different languages and repositories without hardcoding one frontend stack.

## 8.2 Evidence-backed reviews

Design a review system that separates:

- Verified test failures
- Static-analysis findings
- Agent hypotheses
- Unverified concerns
- Confirmed fixes

Every finding should have clear provenance, a relevant file/line where applicable, severity, and an actionable explanation.

Never display an unexecuted test as passing.

A successful lint run is not proof of functional correctness.

## 8.3 Independent review

Evaluate workflows where the implementing agent and reviewing agent are different.

For example:

Claude plans
→ Codex implements
→ tests execute
→ Claude reviews the diff
→ developer accepts or requests changes.

Compare independent review against self-review.

Do not assume cross-agent review is always superior. Design experiments to measure whether it detects meaningful additional issues.

## 8.4 Engineering evaluations

Define repeatable evaluation tasks using representative small repositories with intentionally seeded bugs and predefined expected outcomes.

Measure:

- Correctness
- Tests passed
- Real defects identified
- False-positive review findings
- Regression rate
- Time to verified completion
- Developer review time
- Number of manual interventions
- Provider usage where reported
- Workflow reliability

Recommend an evaluation harness that lets us compare Claudex workflows against normal native-agent usage.

Separate deterministic test evidence from subjective LLM grading.

---

# 9. Production security and authentication

Treat this as a release-blocking area.

Our objective is to support the user's authorized native provider subscription where officially permitted, rather than silently switching to API-billed models.

## 9.1 Authentication

Research:

- Claude SDK authentication precedence
- Installed Claude Code subscription authentication
- API/environment overrides
- Codex account and authentication modes
- Managed organization accounts
- Expired credentials
- Rate limits and paid overage
- Third-party product restrictions
- Commercial versus personal/open-source distribution

The current audit identifies unresolved distribution restrictions.

Do not assume those restrictions are solved.

Create a specific legal/compliance decision gate and identify what requires confirmation from Anthropic or OpenAI.

No credentials, OAuth tokens or secrets should be copied into the webview or persisted by Claudex unnecessarily.

## 9.2 Approval boundaries

Investigate:

- Tool approvals
- Command approvals
- File-writing boundaries
- Host-owned approvals
- Provider-native permissions
- MCP server trust
- Untrusted repository instructions
- Prompt injection through tool output
- Workspace Trust
- Symlink/path traversal
- Credential leakage
- Remote environments

Do not auto-approve unknown requests.

Do not let workflow orchestration bypass native provider permissions.

## 9.3 Process lifecycle

Define robust behavior for:

- Interrupt
- Cancellation
- Provider crash
- Extension reload
- VS Code shutdown
- Orphaned child processes
- MCP subprocesses
- Concurrent sessions
- External native terminal sessions
- Network and authentication errors

Do not claim a job is completed until authoritative completion evidence exists.

---

# 10. Cross-platform production reliability

Target supported macOS, Windows and Linux environments, including remote development where technically supported.

Research:

- Provider installation detection
- Binary paths and PATH differences
- Windows `.exe`, `.cmd` and `.bat` handling
- macOS GUI launch environments
- Linux glibc/musl differences
- ARM64/x64 variants
- Executable permissions
- Node.js runtime requirements
- VS Code extension-host placement
- WSL
- Remote SSH
- Dev Containers
- Filesystem path normalization
- Session storage and profile ownership
- Packaging and extension-host compatibility

Propose a tested support matrix, not a universal promise.

Distinguish development-machine compatibility from an installed VSIX running on another user's machine.

Prioritize reproducible clean-install testing.

Preserve the discovery-first hybrid strategy unless evidence justifies changing it.

---

# 11. Reliability, performance and observability

Research production-level engineering requirements for a long-running multi-agent extension.

Consider:

- Extension activation time
- Memory usage
- Process startup overhead
- Streaming latency
- UI responsiveness
- Large conversations
- High-volume tool events
- Backpressure
- Catalog caching
- Concurrent sessions
- Event ordering
- Process supervision
- Idempotent operations
- Persistent workflow checkpoints
- Recovery after interruption
- Structured error reporting

Keep the extension host responsible for process and session ownership.

Keep the React webview focused on UI.

Evaluate whether an additional local daemon or SQLite database is justified by actual requirements.

Do not introduce a background service or database without comparing simpler alternatives.

Design diagnostic logs with sensitive-data redaction.

No source-code or conversation telemetry should be uploaded without explicit user consent.

Define metrics that will help us identify real performance regressions.

---

# 12. Testing and release engineering

Review the existing test architecture before proposing additions.

The previous audit recorded:

- `pnpm lint` passed with two warnings.
- `pnpm typecheck` passed.
- `pnpm check`, UI tests, provider smoke tests and VSIX packaging were not run during that audit.
- Earlier macOS testing exists, but Windows and Linux are not comprehensively certified.

These are historical observations; recheck current status through non-mutating inspection where possible.

Design a testing pyramid containing:

### Unit tests

- Session state transitions
- Context-packet construction
- Capability negotiation
- Version parsing
- Path resolution
- Permission policy
- Workflow state transitions

### Contract tests

- Claude SDK events
- Codex App Server messages
- Approvals
- Resume
- Interrupt
- Unknown fields
- Provider version differences

### Integration tests

- Fake provider processes
- Temporary repositories
- Worktrees
- Session persistence
- Process crashes
- MCP tool handling
- Workflow orchestration

### UI tests

- Multi-tab sessions
- Handoff preview
- Tool approval
- Diff review
- Workflow progress
- Runtime health
- Recovery and errors

### Packaged-extension tests

- Clean VSIX installation
- Activation
- Bundled SDK loading
- Provider discovery
- Native process launching
- Uninstall/reinstall behavior
- Cross-platform installation

### Authorized live smoke tests

- Native Claude session
- Native Codex session
- Both handoff directions
- Permission rejection
- Crash and resume
- Subscription/authentication behavior

Do not run live tests or operations that consume provider quota without separate authorization.

Propose CI workflows, branch protection, release gates, compatibility checks and rollback strategy.

Define reproducible evidence for every advertised supported platform.

---

# 13. Architecture standards

We want clean, pragmatic, maintainable engineering.

Evaluate the existing architecture against these criteria:

- Cohesive modules
- Clear responsibilities
- Dependency direction
- Type safety
- Minimal duplication
- Robust error contracts
- Native provider extensibility
- Testability
- Reasonable performance
- Controlled side effects
- Easy onboarding for future maintainers

Avoid:

- Excessive generic abstractions
- Giant service classes
- Silent fallbacks
- Reimplementing agent loops
- Duplicating provider configuration
- Experimental APIs without guards
- Unnecessary package dependencies
- Unbounded event histories
- Automatic unsafe retries
- Rewriting working modules without demonstrated benefit

For every significant architectural change, compare:

1. Keep the existing implementation.
2. Refactor the existing implementation.
3. Introduce a focused new component.

Recommend the smallest safe option and explain the tradeoffs.

---

# 14. Produce a milestone-based implementation roadmap

I don't want a vague list of improvements.

Create milestones ordered by dependencies, safety and user value.

Use the previous audit's M0–M5 as the starting point, then reconcile them with the new requirements rather than creating a disconnected second roadmap.

Consider the following broad progression, but adjust it based on evidence:

**Phase A — Secure the foundation**

- Provider integration compatibility
- Authentication and release restrictions
- Runtime validation
- Cross-platform correctness

**Phase B — Reliable agent execution**

- Session ownership
- Persistence
- Recovery
- Process shutdown
- Capability management

**Phase C — Reliable cross-agent workflows**

- Structured handoffs
- Workflow state machine
- Delegation
- Permissions
- Git isolation

**Phase D — Better software engineering outcomes**

- Testing and review
- Evidence collection
- PR workflows
- Independent review
- Quality evaluations

**Phase E — Provider upgrade resilience**

- Upstream monitoring
- Versioned contract tests
- Compatibility matrix
- Canary verification
- Release automation

**Phase F — Product polish and production release**

- UX refinement
- Performance
- Accessibility
- Cross-platform certification
- Security review
- Documentation
- Marketplace readiness

For EACH milestone include:

- Objective
- Current code to reuse
- Changes required
- Files/modules likely affected
- Dependencies
- Engineering risks
- Detailed tasks
- Acceptance criteria
- Test requirements
- Definition of done
- Expected deliverable
- Effort estimate in relative engineering size, not a speculative deadline

Each milestone should be small enough to implement and review independently.

Identify the smallest useful release and clearly distinguish P0 release blockers from later enhancements.

---

# 15. Required final deliverables

Produce the following planning artifacts.

## A. Executive assessment

Explain what currently works, what is risky, and where we should focus engineering effort.

## B. Architecture recommendation

Include component responsibilities, typed boundaries, data flows, process ownership and key design decisions.

Use Mermaid diagrams where helpful.

## C. Provider capability and compatibility matrix

Compare current support against official upstream capabilities and classify stable, experimental, missing and unsupported behavior.

## D. Cross-agent workflow design

Document session identity, handoff packets, workflow states, delegation, permissions, ownership and recovery.

Include at least one complete example of an engineering workflow.

## E. SDK/runtime upgrade strategy

Specify how we detect upstream changes, validate compatibility, manage versions, handle breaking changes, and ship safely.

## F. Engineering quality system

Describe code review, testing, evidence collection, evaluation and human acceptance.

## G. Security and portability assessment

Include unresolved subscription/distribution restrictions, OS compatibility, subprocess behavior and a targeted threat model.

## H. Implementation roadmap

Provide phased milestones with independently verifiable acceptance criteria.

## I. Decision log

For every major choice, record:

- Problem
- Options considered
- Selected recommendation
- Supporting evidence
- Tradeoffs
- Rejected alternatives
- Remaining uncertainty

## J. Open questions and risks

Separate genuine decisions requiring user input from questions that can be resolved through repository inspection or official documentation.

Do not ask questions already answered by the current repository or supplied audit.

---

# 16. Quality standard for your research and plan

Be critical and evidence-driven.

- Inspect the actual code before diagnosing gaps.
- Read the existing audit before introducing new work.
- Verify current provider documentation rather than relying on assumptions.
- Cite file paths and functions for repository findings.
- Link official sources for external technical claims.
- Identify when upstream source is experimental.
- Distinguish tested, code-inspected, documentation-supported and unverified claims.
- Challenge unnecessary complexity.
- Prefer capabilities that materially improve developer productivity or code quality.
- Respect existing architectural decisions unless there is compelling evidence to change them.
- Do not promise perfect compatibility with future SDK versions.
- Do not claim that an agent-reviewed patch is correct without appropriate verification.
- Never present subscription-authentication legality as resolved unless authoritative evidence supports it.

The plan should be detailed enough that a coding agent can implement one milestone at a time without redesigning the entire system.

However, it must remain readable and decision-oriented rather than an enormous collection of speculative features.

**Final instruction:**

First inspect and research. Then produce the complete plan, technical decisions, capability matrix, and milestone breakdown.

Do not begin implementation.

Do not install or upgrade dependencies.

Do not make live provider calls.

Do not alter credentials or authentication.

Do not schedule recurring jobs.

Do not publish anything.

Stop once the plan is complete and ready for engineering review.
