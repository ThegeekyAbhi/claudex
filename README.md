# Agent Workspace

A local VS Code extension for Codex and Claude Code. Threads, thinking, approvals, diffs, agents working under other agents, and ordinary Markdown plans live together in one quiet workspace.

## Install

In VS Code, run **Extensions: Install from VSIX…** and select `agent-workspace-0.5.0.vsix`. Open a local project folder, then click the sparkle button in the editor title bar or status bar. Chat opens in the right side panel, next to your code. Use the history button to switch threads, or **Agent Workspace: Open in Editor** for the larger layout with the thread list on its right. VS Code older than 1.106 can't host extension views on the right, so it opens from the activity bar instead.

Codex and Claude Code must already be installed and signed in through their own tools. If VS Code cannot find them, configure `agentWorkspace.codexPath` and `agentWorkspace.claudePath` with their absolute executable paths. Common macOS installation folders are detected automatically.

## Use

1. Choose **New thread**, type, and press **Enter** (**Shift+Enter** for a new line). Nothing else is asked. The thread takes the name Claude or Codex gives it, falling back to your first line; click the name to rename it.
2. Pick the model and reasoning effort from the model menu: agents on the left, that agent's models on the right. Use ← → to change agent, and type to search all of them. **Default** leaves your CLI's own configuration in place. Models come from your installed CLIs, with older versions under **More models**. The location control sits under the message box.
3. Choose **Agent** or **Plan** next to it, or press ⇧Tab. In Plan mode the agent uses its CLI's own plan mode, and the plan stays pinned above the thread as Markdown. **Build it** answers the agent's request, or starts a normal turn if none is waiting; it records your decision and says nothing about whether the work succeeds. **Save** writes the plan to `docs/agent-work/`.
4. Type `@` to attach context: recent and searched files, folders, past threads, a terminal's last command (where shell integration is on), the branch diff with main, or images. `#` goes straight to files. An `@codex`, `@claude`, or `@claude2` at the very start of a message still runs that agent as a child thread.
5. Paste images, attach them with the paperclip, or pick them from `@`. Images Codex generates appear in the thread, and open full size on click.
6. When an agent asks you something, the questions dock on the message box, one at a time. Press a letter to pick, Enter to continue, and Esc to skip; skipping tells the agent you declined.
7. The ring beside the paperclip shows how full the thread's context is. Hover it for your plan's limits and when they reset. It stays hidden until a CLI reports numbers, and offers a handoff when a thread or limit is nearly full. Changes apply from the next turn. Picking a different agent on a started thread moves your draft to a new thread.
3. New threads work in your open folder. Choose **New worktree** in the location menu for one thread, or **Continue in a new worktree** later. Worktrees start from committed HEAD and do not copy uncommitted files. The extension never cleans up or merges worktrees.
4. Follow the work in the thread: thinking, commands, and reads collapse into a summary when a turn ends, and diffs stay visible. Approval cards offer **Allow once**, **Decline**, and answers to supported agent questions.
5. **Run another agent** either way:
   - Start a message with `@codex`, `@claude`, or `@claude2`. It runs straight away as a child thread. Its result is added to your next message only if you choose **Add this result**.
   - Ask in plain words: "run a Codex agent and tell it to review this." The agent calls its `run_agent` tool, you approve the prompt, the other agent runs as a child thread, and its final message goes back to the agent that asked.

   Child threads appear on an inline card and nested in the sidebar. Their approvals appear on the card too. Each one is a normal session you can open and message. Both agents share the folder unless you started in a worktree, so avoid overlapping edits.
6. Open **Changes** in the header to see every uncommitted change in the thread's checkout, read from Git. Each file opens in VS Code's diff editor.
7. Use **Docs** for plans, task briefs, reviews, and handoffs in `docs/agent-work/`. Agents can write there too, and the list updates itself. A handoff opens the other provider with an editable draft that is never sent automatically.
8. Use the terminal button to stop a rich-chat turn and resume its provider session in the native CLI. Send at least one message first so a provider session ID exists. Close that terminal before returning to rich chat.

## Local boundaries

There is no application backend, model API integration, extension telemetry, or credential store. The extension launches your unmodified CLIs; those tools retain their normal provider connections, settings, authentication, and usage limits. No agent configs or harness code are patched. The Claude SDK is used only to bridge your installed Claude Code executable and its permission callbacks.

Transcript projections and session references are stored as a versioned JSON file under VS Code’s workspace-specific extension storage. Drafts and scroll positions use local webview state. These records may include prompts and tool output; treat them like local CLI history. Unfinished sessions restore as interrupted and are not automatically restarted.

## Development

Node 24 and pnpm 10.33.2 were used. From this independent project folder:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:ui
pnpm package
```

Press **F5** in VS Code to launch an Extension Development Host. `pnpm preview` serves a design-only preview at `http://127.0.0.1:4173`. It cannot run agents. `pnpm smoke` sends tiny test prompts through both signed-in CLIs and verifies conversation resume. `pnpm smoke:delegate` has each agent run the other through `run_agent` and checks the answer comes back. Both use normal provider quota.

See `docs/integration.md` and `docs/verification.md` in the local project for integration notes and verification evidence.

## Current limits

- Only sessions created by this extension are indexed. Existing CLI history and already-running terminal sessions are not imported.
- A delegated agent cannot see the conversation that started it; it receives only its prompt. A delegated agent cannot start another.
- Codex and Claude both expose only part of their thinking: summaries, when the model produces them. Some turns show none.
- Most Codex threads keep their first-prompt title, because Codex usually leaves its thread name unset.
- Internal worker visibility depends on provider events. Full child transcripts are not guaranteed; Claude task IDs are not resumable conversation IDs.
- Native terminal activity is not mirrored into the rich transcript. Resuming rich chat retains provider-side context, but the local rich view does not backfill terminal messages.
- Complex unsupported Codex requests are rejected rather than implicitly approved. Native CLI access remains available. CLI/SDK upgrades need compatibility testing.
- Closing or reloading the extension interrupts rich-chat work. Native terminals remain managed by VS Code. Native live workers, interactive pickers, every permission type, and prolonged workloads still need manual end-to-end acceptance.

This is a personal macOS tool, packaged for local installation.

## License

The source code is MIT licensed; see `LICENSE`. A built VSIX also bundles the Claude Agent SDK, which is under Anthropic's own terms, not MIT; see `THIRD_PARTY_NOTICES.md`.

## Two Claude accounts

**Claude 2** works without setup if you use an alias like `claude2='CLAUDE_CONFIG_DIR=~/.claude-account2 claude'`. VS Code cannot see shell aliases, so the extension runs `claude` with that folder as `CLAUDE_CONFIG_DIR`. Use `agentWorkspace.claud2ConfigDir` if your folder differs. A `claud2` or `claude2` executable on your PATH takes priority, as does an explicit `agentWorkspace.claud2Path`. Existing threads keep their launcher, including when resumed in the native terminal.
