> Paths in these historical notes were later renamed; see [renames.md](renames.md).

# Sessions restructure

## Changes and design

`Sessions` remains the public facade at `src/harness/session-manager.ts`, with the same constructor and public method signatures. `createAgentFactory`, `AgentFactory`, `PlanFiles`, `Launcher`, and `LauncherLookup` remain importable from that module. The facade keeps session creation, lookup, user settings, change notifications and composition.

Each service owns its state (SRP). Approval requests and transitions, file observations and capture bookkeeping, delegation waiters, turn agents and generations, and the persistence queue/timer are private to their respective services. Callers use operations, never their collections or timer handles. In particular, removal now calls `files.forget`, `turns.forget` and `approvals.clear` in the original order.

The shared runtime `SessionContext` was removed. Construction happens only in the `Sessions` constructor. Each service declares a minimal dependency interface with callbacks or method-only `Pick` contracts (DIP). The approvals-to-turns cycle uses a `stopTurn` callback; disposal checks use an `isDisposed` callback. Services receive neither the facade nor a back-reference to a dependency graph. Existing public operations still dispatch through facade callbacks, including `flush`, so overrides and failure injection retain their behavior. Promise-returning facade methods forward the service's promise directly.

Provider construction uses an exhaustive, typed registry (OCP/DIP). The harness resolves a launcher and dependencies without importing either concrete adapter. Registering another provider's factory requires no factory-dispatch branch in the harness; the provider domain and persisted schema remain unchanged.

## Module map

| File | Responsibility and state boundary |
| --- | --- |
| `src/harness/session-manager.ts` | Public facade, composition, session collection operations, settings, change notifications and the private disposed flag. |
| `src/harness/session-types.ts` | Type-only `AgentFactory` and `PlanFiles` contracts; replaces the removed runtime context module. |
| `src/harness/agent-factory.ts` | Profile-aware launcher resolution and registry dispatch with lazy skill lookup. |
| `src/providers/registry.ts` | Provider-id-to-factory mapping and concrete adapter construction. Owns the launcher contract. |
| `src/harness/turn-lifecycle.ts` | Sending, generation guards, provider and worker events, interruption, disconnect and disposal. Owns private agents/generations; `forget` handles removal. |
| `src/harness/session-approvals.ts` | Private pending requests/transitions, answers, Allow in Auto and stop/persist/resume transitions. Exposes record, pendingFor, clear, clearAll, assertAvailable and cancelTransition. |
| `src/harness/session-plans.ts` | Plan file saving/reading, building, handoff and feedback through action callbacks and the plan-file port. |
| `src/harness/session-delegation.ts` | Delegated child creation and private waiters. Exposes activeDelegates, notifySettled and settleAll. |
| `src/harness/session-persistence.ts` | Loading, version-1 serialization, atomic replacement and private queue, last-saved value and timer. Exposes scheduleSave rather than a timer handle. |
| `src/harness/session-files.ts` | Private per-turn observations and native/observed file reconciliation. Exposes observe, captureAfterTool, captureFiles, flush/flushAll, release and forget/forgetAll. |
| `tests/unit/providers/registry.test.ts`, `tests/unit/application/sessions/{agent-factory,session-approvals,session-persistence}.test.ts`, and `tests/integration/application/sessions/session-persistence.test.ts` | Twelve focused registry, factory, approval and persistence tests. |
| `tests/unit/application/sessions/session-files.test.ts` | Six focused tests for capture eligibility, release, flush, observation identity and stale callbacks. |

## Statement order and deliberately separate operations

Encapsulation preserves operation order rather than combining related cleanup steps:

- `remove`: detach children, splice the session, forget its observation, dispose its agent, delete the agent, delete its generation, clear pending approvals, notify change. `turns.forget` retains dispose-before-delete ordering. Stop and disconnect keep their own different invalidation/disposal order; they do not reuse `forget`.
- `approve`: remove the answered request, choose the next request/status, invoke the response, then notify change. `record` preserves insertion order and replaces duplicate IDs without moving them. `pendingFor` returns the first approval, not the mutable pending map.
- `approvals.clear` only removes pending callbacks. It does not respond, change status, remove `session.approval`, notify or touch transitions. The lifecycle performs those separate actions at their original positions. `clearAll` likewise clears pending callbacks only.
- `receive`: record an approval before `applyEvent`; after applying the event, perform tool capture, terminal capture, final-plan saving, terminal pending-request clearing, pending approval/status projection, waiter settlement and change notification in that order. The old tool condition and finished-tool marking live in `captureAfterTool`, called at the same location.
- `captureFiles`: checkpoint first, then mark the captured observation closed, clear its native-diff tracking and release that same observer. A private helper receives the captured observation directly so a reentrant checkpoint callback that installs another observation cannot cause the new observer to be released instead. Public `release(id)` closes once and leaves the observation flushable; forgetting an observation only removes it and deliberately does not release it.
- `dispose`: dispose agents, request final captures, await all observer flushes, mark disposed, forget observations, mark unfinished sessions interrupted, settle a snapshot of waiter IDs, clear agents/generations/pending approvals, then flush storage. `settleAll` retains delete-before-resolve for each waiter. `flush` and `flushAll` return their underlying promises directly, without introducing another await boundary.
- `changed`: emit change first, check disposal, then ask persistence to schedule. `scheduleSave` checks the private timer before scheduling, coalesces against the first deadline, and invokes the facade's current `flush` callback when it fires. Explicit flush still cancels the timer before serializing.

These distinctions preserve the original side effects; they intentionally do not introduce broader automatic cleanup.

## Deliberately unchanged

- Guidance import lines in `session-manager.ts` are unchanged. Their values are supplied to turn lifecycle through its dependencies. Guidance files and `file-observer.ts` were not edited.
- Core schemas, provider adapters, CLI behavior, host and webview were not edited. No dependencies, settings, commands, message types or persisted keys changed.
- Serialization retains the same property order, compact JSON, version number, transient approval/transition omission and `persistableSession` call. The legacy `claud2` compatibility field remains. File mode, temporary filename, rename order, save delay, queuing and error recovery remain unchanged.
- No tool exit or checkbox is treated as proof of task completion. Restore never launches an agent, preserves local/native session IDs and uses the existing core restoration rules.

## Suspected existing risks, not fixed

- A plan-file save failure appends a notice with `applyTranscript` without calling `changed`; notification/persistence of that notice depends on later activity.
- `disconnect` clears the agent and approvals without the final capture/observer flush performed by `stopTurn`.
- If disposal or a generation change occurs while `FileObserver.start` is pending, `send` returns without explicitly releasing the newly obtained observer.
- The streaming latency test has a load-sensitive 50 ms wall-clock assertion. It was not changed. Both round-2 full checks passed without a timing failure (206 tests before adding timer tests; 208 in the final run).

## Verification

- Used pnpm **10.33.2** and ran `pnpm format`.
- Reviewed the original operation order against the encapsulated calls, especially removal, event reception, stop, disposal, final capture and timer scheduling.
- Searched `src/harness` for `SessionContext`, `session-context` and `context\.[a-z]+\.[a-zA-Z]+`: no matches. Reviewed state access separately: maps and timer handles are accessed only inside their owning service, with TypeScript private fields enforcing the boundary.
- Registry and byte-for-byte legacy persistence tests remain intact. Approval tests now set up requests through `record`, inspect through `pendingFor`, and establish a real Auto transition rather than mutating its map. Existing response-order, transition-guard and permission assertions remain.
- Added tests for duplicate-request replacement/order and isolated clearing without responses or notifications; final-capture/release ordering and identity under reentrancy; idempotent release that preserves queued reports and flushing; forgetting without release; stale/disposed callback rejection; flush order; tool eligibility/deduplication; and deterministic save coalescing, explicit-flush timer cancellation and error forwarding.
- Existing integration assertions were preserved, including Auto persistence-failure overrides and the streaming timing assertion.
- Final `pnpm check`: **exit 0**. Lint, typecheck, all **208 tests passed** (0 failed, 0 cancelled, 0 skipped, 0 todo), and build passed. `git diff --check` passed.
- Did not run smoke calls, UI tests or packaging. No commit, branch, push or other-worktree changes were made.
