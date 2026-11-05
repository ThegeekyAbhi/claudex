# Claudex user guide

[Back to the overview](../README.md)

## Use

1. Choose **New thread**, type, and press **Enter** (**Shift+Enter** for a new line). Nothing else is asked. The thread takes the name Claude or Codex gives it, falling back to your first line; click the name to rename it.
2. Pick the model and reasoning effort from the model menu: agents on the left, that agent's models on the right. Use ← → to change agent, and type to search all of them. **Default** leaves your CLI's own configuration in place. Models come from your installed CLIs, with older versions under **More models**. The location control sits under the message box.
3. Choose a mode next to it, or cycle with ⇧Tab. **Ask** answers without changing anything, **Plan** researches and writes a plan, and **Auto** works while the CLI's own reviewer handles approval requests, asking you when it can't decide. New chats start in Auto. It reduces prompts but doesn't guarantee safety, and Claude's Auto can push to your default branch unless you state otherwise. If Auto can't apply, the chip says what's really running, such as **Manual** for an unsupported Claude model or **Your Codex settings** when the approval policy isn't `on-request`, and the thread says why. Threads saved in the old Agent mode reopen as **Default**. Your last choice is remembered per agent for new threads. Bypass and full access are never offered.
   - **Plans:** while drafting you see a quiet **Planning…** row. When it's ready, a **Created plan** card offers **View Plan** and **Implement plan** (⌘⏎). View Plan opens the plan in the center as a Markdown document, saved in the extension's own folder rather than your repo. Edit it with **Open as text**: implementing reads the file when you click, so your edits count. The card also offers Auto or a linked agent. To change the plan, just type in the message box.
   - **Guided planning:** Plan mode asks for clear, evidence-based plans using the 7 Cs of communication, useful Mermaid diagrams, and acceptance tests. Expand **Planning guide** under your message to inspect the instructions. Disable **Claudex: Guided Planning** to use only the provider's native planning guidance. Turn it on or off from the toggle beside the composer controls in Plan mode.
   - **Implement plan:** the plan card's button switches the thread to Auto and builds. A Plan reply with no plan card shows **Implement** above the composer. If a build can't start, the plan and mode go back as they were, and the notice says why.
   - **Visual explanations:** in Ask mode, agents can add a sandboxed visual (a `visual` code fence holding HTML or SVG) when a picture explains something better. Scripts, network requests, and remote images are blocked. Turn it on or off from the toggle in Ask mode, or with `agentWorkspace.richExplanations`.
   - **Tabs:** open threads appear as tabs, and every click of **+** opens a new chat, so several agents can work at once. What you've typed stays in its tab whether you've sent it or not. Closing a tab only closes the view: the agent keeps going and the thread stays in Chats. A dot marks what needs attention: amber when it needs your review, red when it failed, blue when it finished since you last looked. A spinner means it's running.
   - **Threads:** finished subagents collapse into an **N earlier** row under their parent. **Running only** in the Chats header narrows the list to threads with work going on. Failed and interrupted threads stay visible, and search looks through everything. **Needs you** and **Running** sit at the top of Chats, above the threads sorted by time.
   - **Thinking:** choose Default, On, or Off beside the model picker. Off appears only when disabling thinking is verified for that model; reasoning effort and expandable summaries are separate controls. Default preserves native thinking configuration.
   - **Skills:** type `/` to search your skills, and pick one to add a removable chip. A chip means you asked for it. Only a real tool call from the CLI reads "Used skill". Open **… → Skills** to browse each agent's skills, open a `SKILL.md`, or turn Codex skills on and off.
4. Type `@` to attach context: recent and searched files, folders, past threads, a terminal's last command (where shell integration is on), the branch diff with main, or images. `#` goes straight to files. An `@codex`, `@claude`, or `@claude2` at the very start of a message still runs that agent as a child thread.
5. Paste images, attach them with the paperclip, or pick them from `@`. Images Codex generates appear in the thread, and open full size on click.
6. When an agent asks you something, the questions dock on the message box, one at a time. Press a letter to pick, Enter to continue, and Esc to skip; skipping tells the agent you declined.
7. The compact labels and ring beside the paperclip show reported context, 5-hour, and weekly usage when available. Hover for reset times, your plan's limits, the thread's real mode, the skills you asked for, its MCP servers, and its instruction files. A failed MCP server adds an amber dot. It stays hidden until a CLI reports numbers, and offers a handoff when a thread or limit is nearly full. Changes apply from the next turn. Picking a different agent on a started thread continues it there (below).
3. New threads work in your open folder. Choose **New worktree** in the location menu for one thread, or **Continue in a new worktree** later. Worktrees start from committed HEAD and do not copy uncommitted files. The extension never cleans up or merges worktrees.
4. Follow the work in the thread: thinking, commands, and reads collapse into a summary when a turn ends, and diffs stay visible. In Git checkouts, shell edits also appear as **Observed file changes**, compared against the files as they were before the turn and after each command. Existing uncommitted edits are excluded; concurrent edits can be included, so these observations do not establish authorship. Capture excludes ignored files and symlinks and is bounded to 10,000 files, 256 KiB per file, and 32 MiB total; binary, skipped, or unavailable content is identified. Shell renames appear as a deletion and an addition. Historical command diffs are not reconstructed. Approval cards offer **Allow once**, **Decline**, and answers to supported agent questions. Eligible native tool requests also offer **Allow in Auto**: this allows that one request, then continues in the provider's Auto mode. Claude Code switches straight away; Codex applies it from its next turn and requires an on-request approval policy. Provider restrictions still apply.
5. **Run another agent** either way:
   - Start a message with `@codex`, `@claude`, or `@claude2`, or pick one from the `@` menu anywhere in a message, which moves it to the front and keeps your words. A name you type mid-sentence and don't pick stays plain text. It runs straight away in a card, under the agent you had selected, which isn't sent the message. Each card shows who asked and in what words. Its result is added to your next message only if you choose **Add this result**.
   - Ask in plain words: "run a Codex agent and tell it to review this." The agent calls its `run_agent` tool, you approve the prompt, the other agent runs as a child thread, and its final message goes back to the agent that asked.

   Child threads appear on an inline card and nested in the sidebar. Their approvals appear on the card too. Each one is a normal session you can open and message. Both agents share the folder unless you started in a worktree, so avoid overlapping edits.
6. Open **Changes** in the header to see every uncommitted change in the thread's checkout, read from Git. Each file opens in VS Code's diff editor.
   - **Continue in another agent:** pick another agent in the model menu, or use **… → Continue in Codex / Claude / Claude 2**. Your draft moves with a **Context from …** chip; click it to see exactly what will be sent, or remove it. Nothing goes until you press Enter. The other agent receives your messages, its replies, commands with their reported status and exit codes, files changed, and the plan, kept by this extension and built with no extra model call. Going back to an agent that already has a linked thread resumes that same native session and sends only what happened since. Hidden reasoning, provider-side context, and approvals never transfer, and a thread still working in the same checkout must finish or be stopped first. `agentWorkspace.crossAgentContext` chooses `recent` (about 10k tokens, the default), `full` (about 75k), or `off`, which moves only your draft as before. The history goes to the other provider, so mind what your project allows.
7. Use **Docs** for plans, task briefs, reviews, and handoffs in `docs/agent-work/`. Agents can write there too, and the list updates itself. A handoff opens the other provider with an editable draft that is never sent automatically.
8. Use the terminal button in the top bar to continue a thread in the native CLI, in the same mode and on the same model where the CLI has a flag for it (Codex has none for Plan, and the thread says so). A running turn is stopped first, after asking. Send at least one message first so a provider session ID exists. While it's open, the composer offers **Show terminal** and **Back to chat**. When it closes, what happened there is added to the chat under a "From terminal" notice.

## Local boundaries

There is no application backend, model API integration, extension telemetry, or credential store. The extension launches your unmodified CLIs; those tools retain their normal provider connections, settings, authentication, and usage limits. No agent configs or harness code are patched. The Claude SDK is used only to bridge your installed Claude Code executable and its permission callbacks.

Transcript projections and session references are stored as a versioned JSON file under VS Code’s workspace-specific extension storage. Drafts and scroll positions use local webview state. These records may include prompts and tool output; treat them like local CLI history. Unfinished sessions restore as interrupted and are not automatically restarted.

By default, dark themes use Cursor's dark colors. Choose **Use editor theme colors** from the `...` menu, or set `agentWorkspace.appearance` to `editor`, to follow VS Code's theme everywhere. Light and high-contrast themes always follow VS Code, and fonts, syntax colors, and diff colors follow it in every mode. Ask, Plan, Agent, and Auto each have their own color on the mode chip and send button.

## Upgrading from Agent Workspace

Claudex uses the extension ID `nerdyabhi.claudex`. The earlier local build used `local-workspace.agent-workspace`, so VS Code treats these as separate extensions with separate storage. Existing history is not automatically migrated; keep the old installation and its data if you need those threads. Disable the old extension before using Claudex to avoid duplicate commands and views. Settings retain their `agentWorkspace.*` keys.

## Development

Node 24 and pnpm 10.33.2 were used. From this independent project folder:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:ui
pnpm package
```

`pnpm package` writes `releases/claudex-<version>.vsix` using the version in `package.json`. `pnpm test:ui` saves all captures, including failure screenshots, to `test-results/screenshots/`. Both output folders are ignored by Git and excluded from the VSIX.

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
- Terminal activity appears in the chat when the terminal closes, as text with a count of tool calls, not live. After a window reload a terminal that's still open isn't tracked, so avoid sending from both.
- Complex unsupported Codex requests are rejected rather than implicitly approved. Native CLI access remains available. CLI/SDK upgrades need compatibility testing.
- Closing or reloading the extension interrupts rich-chat work. Native terminals remain managed by VS Code. Native live workers, interactive pickers, every permission type, and prolonged workloads still need manual end-to-end acceptance.

Claudex is developed and tested on macOS. Windows, Linux, remote workspaces, and prolonged workloads have not yet been validated.

## License

The source code is MIT licensed; see [LICENSE](../LICENSE). A built VSIX also bundles the Claude Agent SDK, which is under Anthropic's own terms, not MIT; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Two Claude accounts

**Claude 2** works without setup if you use an alias like `claude2='CLAUDE_CONFIG_DIR=~/.claude-account2 claude'`. VS Code cannot see shell aliases, so the extension runs `claude` with that folder as `CLAUDE_CONFIG_DIR`. Use `agentWorkspace.claud2ConfigDir` if your folder differs. A `claud2` or `claude2` executable on your PATH takes priority, as does an explicit `agentWorkspace.claud2Path`. Existing threads keep their launcher, including when resumed in the native terminal.
