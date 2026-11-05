# Agent Workspace

A local VS Code extension for Codex and Claude Code. Threads, thinking, approvals, diffs, agents working under other agents, and ordinary Markdown plans live together in one quiet workspace.

## Install

In VS Code, run **Extensions: Install from VSIX…** and select `releases/agent-workspace-0.7.0.vsix`. Open a local project folder, then click the sparkle button in the editor title bar or status bar. Chat opens in the right side panel, next to your code. Use the history button to switch threads, or **Agent Workspace: Open in Editor** for the larger layout with the thread list on its right. VS Code older than 1.106 can't host extension views on the right, so it opens from the activity bar instead.

Codex and Claude Code must already be installed and signed in through their own tools. If VS Code cannot find them, configure `agentWorkspace.codexPath` and `agentWorkspace.claudePath` with their absolute executable paths. Common macOS installation folders are detected automatically.

## Use

1. Choose **New thread**, type, and press **Enter** (**Shift+Enter** for a new line). Nothing else is asked. The thread takes the name Claude or Codex gives it, falling back to your first line; click the name to rename it.
2. Pick the model and reasoning effort from the model menu: agents on the left, that agent's models on the right. Use ← → to change agent, and type to search all of them. **Default** leaves your CLI's own configuration in place. Models come from your installed CLIs, with older versions under **More models**. The location control sits under the message box.
3. Choose a mode next to it, or cycle with ⇧Tab. **Ask** answers without changing anything, **Plan** researches and writes a plan, **Agent** works and asks when needed, and **Auto** lets the CLI's own reviewer handle approval requests. Until you choose, your CLI's default stands and the chip says **Default**. Once a CLI reports its mode, the chip shows what it really is. Your last choice is remembered per agent for new threads. Bypass and full access are never offered.
   - **Plans:** while drafting you see a quiet **Planning…** row. When it's ready, a **Created plan** card offers **View Plan** and **Build** (⌘⏎). View Plan opens the plan in the center as a Markdown document, saved in the extension's own folder rather than your repo. Edit it with **Open as text**: Build reads the file when you click, so your edits count. **Build ▾** also offers Auto or another agent. To change the plan, just type in the message box.
   - **Guided planning:** Plan mode asks for clear, evidence-based plans using the 7 Cs of communication, useful Mermaid diagrams, and acceptance tests. Expand **Planning guide** under your message to inspect the instructions. Disable **Agent Workspace: Guided Planning** to use only the provider's native planning guidance.
   - **Thinking:** choose Default, On, or Off beside the model picker. Off appears only when disabling thinking is verified for that model; reasoning effort and expandable summaries are separate controls. Default preserves native thinking configuration.
   - **Skills:** type `/` to search your skills, and pick one to add a removable chip. A chip means you asked for it. Only a real tool call from the CLI reads "Used skill". Open **… → Skills** to browse each agent's skills, open a `SKILL.md`, or turn Codex skills on and off.
4. Type `@` to attach context: recent and searched files, folders, past threads, a terminal's last command (where shell integration is on), the branch diff with main, or images. `#` goes straight to files. An `@codex`, `@claude`, or `@claude2` at the very start of a message still runs that agent as a child thread.
5. Paste images, attach them with the paperclip, or pick them from `@`. Images Codex generates appear in the thread, and open full size on click.
6. When an agent asks you something, the questions dock on the message box, one at a time. Press a letter to pick, Enter to continue, and Esc to skip; skipping tells the agent you declined.
7. The compact labels and ring beside the paperclip show reported context, 5-hour, and weekly usage when available. Hover for reset times, your plan's limits, the thread's real mode, the skills you asked for, its MCP servers, and its instruction files. A failed MCP server adds an amber dot. It stays hidden until a CLI reports numbers, and offers a handoff when a thread or limit is nearly full. Changes apply from the next turn. Picking a different agent on a started thread moves your draft to a new thread.
3. New threads work in your open folder. Choose **New worktree** in the location menu for one thread, or **Continue in a new worktree** later. Worktrees start from committed HEAD and do not copy uncommitted files. The extension never cleans up or merges worktrees.
4. Follow the work in the thread: thinking, commands, and reads collapse into a summary when a turn ends, and diffs stay visible. In Git checkouts, shell edits also appear as **Observed file changes**, compared against the files as they were before the turn and after each command. Existing uncommitted edits are excluded; concurrent edits can be included, so these observations do not establish authorship. Capture excludes ignored files and symlinks and is bounded to 10,000 files, 256 KiB per file, and 32 MiB total; binary, skipped, or unavailable content is identified. Shell renames appear as a deletion and an addition. Historical command diffs are not reconstructed. Approval cards offer **Allow once**, **Decline**, and answers to supported agent questions. Eligible native tool requests also offer **Stop and resume in Auto**: this confirms the old turn stopped, preserves its session, and asks the provider to continue with native Auto. It never approves or directly replays the paused command. Codex requires an on-request approval policy; provider restrictions still apply.
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

The interface and Mermaid diagrams follow VS Code’s selected theme and font settings, including light and high-contrast themes.

## Development

Node 24 and pnpm 10.33.2 were used. From this independent project folder:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:ui
pnpm package
```

`pnpm package` writes `releases/agent-workspace-<version>.vsix` using the version in `package.json`. `pnpm test:ui` saves all captures, including failure screenshots, to `test-results/screenshots/`. Both output folders are ignored by Git and excluded from the VSIX.

Press **F5** in VS Code to launch an Extension Development Host. `pnpm preview` serves a design-only preview at `http://127.0.0.1:4173`. It cannot run agents. `pnpm smoke` sends tiny test prompts through both signed-in CLIs and verifies conversation resume. `pnpm smoke:delegate` has each agent run the other through `run_agent` and checks the answer comes back. Both use normal provider quota.

See `docs/integration.md` and `docs/verification.md` in the local project for integration notes and verification evidence.

## Current limits

- **Ask on Claude:** edit tools are off and anything not already allowed is denied, but a Bash command your Claude settings allow can still run. Codex's Ask is a read-only sandbox with no network.
- **Claude skills** show no source or file path, because Claude's command list doesn't report them. It also has no API for turning a skill on or off, so those rows offer neither.
- Installing skills belongs to the CLIs. There's no marketplace or installer here.
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
