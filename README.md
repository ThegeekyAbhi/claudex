# Claudex — Claude Code and Codex AI chat for VS Code

**Two coding agents. One place to work.**

Use Claude Code and Codex beside your code, with your existing CLI accounts and settings. Ask questions, turn a plan into working code, and review changes in VS Code. Continue a conversation with another agent and choose what context to carry forward.

## Why Claudex?

- **Keep the context when you switch agents.** Continue a thread with Claude Code or Codex and inspect the context chip before sending.
- **Go from plan to implementation.** Review and edit a Markdown plan, then start implementation from the latest version.
- **Review the work as it happens.** Respond to provider approval requests and open changed files in VS Code’s diff editor.
- **Give each task its own space.** Keep local conversation threads and optionally start a task in a Git worktree.
- **Bring your existing setup.** Use your installed agents’ skills and MCP configuration, with separate profiles for additional accounts.

Requires Claude Code or Codex installed and signed in. Provider usage limits still apply. Developed and tested on macOS; other platforms have not yet been validated.

## Get started

Requires VS Code 1.96+, a trusted local project folder, and Codex or Claude Code installed and signed in. Usage follows your existing provider account and limits.

1. Install **Claudex** from Extensions, or run **Extensions: Install from VSIX…** to install a downloaded VSIX.
2. Open your project folder and run **Claudex: Open Workspace** from the Command Palette. You can also click the sparkle button in the editor title bar or status bar.
3. Chat opens beside your code. For the larger layout shown below, run **Claudex: Open in Editor**.

If an agent isn't found, set `agentWorkspace.codexPath` or `agentWorkspace.claudePath` to its executable's absolute path.

## How to use it

Screenshots show the current UI with sample conversations.

### 1. Start a chat

Click **+** for a new thread. Choose your agent and model from the model menu below the message box; **Default** uses your CLI's configuration. Pick a mode:

| Mode | Use it to |
| --- | --- |
| **Ask** | Ask questions about your code. Edit tools are disabled. |
| **Plan** | Research a task and prepare a plan before building. |
| **Auto** | Work on a task with the CLI's approval reviewer. It asks you when it cannot decide. |

Claude's Ask mode can still run shell commands allowed by your Claude settings. New chats start in Auto. If the provider cannot apply it, the mode label shows what is actually running. Auto does not guarantee safety; state any limits in your prompt.

Type your request and press **Enter**. Use **Shift+Enter** for a new line. Type **@** to add files, folders, threads, or other context; use the paperclip to attach images. Type **/** to choose a skill.

![Choose Ask, Plan, or Auto from the mode menu. Sample conversation.](media/guide/modes.gif)

### Use multiple Claude and Codex accounts

Keep personal and work accounts in separate profiles. Open the **model selector → Manage account → Add account**, choose Claude Code or Codex, name the account, and keep **Create a separate account** selected. Then use **Open sign-in terminal** to complete the CLI’s own sign-in.

![Adding Claude Work and Codex Work profiles with separate account folders. Sample accounts; sign-in happens separately.](media/guide/accounts-add.gif)

After signing in, choose the account in the model selector, then choose its model. Your unsent draft stays in place.

![Switching between sample Claude and Codex account profiles and selecting a model without sending the draft.](media/guide/accounts-switch.gif)

[Still images and account instructions](docs/usage.md#multiple-accounts)

### 2. Review a plan, then build

Select **Plan** and describe the task. Review the plan inline, use **Open plan** to read it in VS Code, or **Edit plan** to edit its Markdown. Reply in chat to request changes or add notes in the composer. Click **Implement in Auto** when ready; it reads your latest edits and switches the thread to Auto.

![Review a Markdown plan and choose how to implement it. Sample conversation.](media/guide/planning.gif)

### 3. Review requests and changes

When a request appears, read the command or action, then choose **Allow once** or **Decline**. Open **Changes** in the header to see uncommitted files in the thread's checkout. Click a file to open VS Code's diff editor.

![Browse changed files and request the native VS Code Changes editor. Sample conversation.](media/guide/changes.gif)

Use the tabs or **Chats** to return to a thread. Closing a tab keeps the conversation and any running work. To continue with another agent, choose it from the model menu, inspect the **Context from …** chip, and press Enter to send.

### More visual guides

**Choose a model and reasoning effort** — [Instructions and static image](docs/visual-guide.md#models)

![Search models and select reasoning effort. Sample UI demonstration.](media/guide/models.gif)

These short clips use sample conversations. Native editor actions stop at the webview boundary; no provider work runs during capture.

**Read rich answers in Ask mode** — [Instructions and static image](docs/visual-guide.md#ask-markdown)

![Read rich answers in Ask mode. Sample UI demonstration.](media/guide/ask-markdown.gif)

**Understand diagrams and visual explanations** — [Instructions and static image](docs/visual-guide.md#visual-explanations)

![Understand diagrams and visual explanations. Sample UI demonstration.](media/guide/visual-explanations.gif)

**Answer agent questions** — [Instructions and static image](docs/visual-guide.md#questions)

![Answer agent questions. Sample UI demonstration.](media/guide/questions.gif)

**Review approval requests** — [Instructions and static image](docs/visual-guide.md#approvals)

![Review approval requests. Sample UI demonstration.](media/guide/approvals.gif)

**Keep multiple chats and find past work** — [Instructions and static image](docs/visual-guide.md#chats-history)

![Keep multiple chats and find past work. Sample UI demonstration.](media/guide/chats-history.gif)

**Attach relevant context** — [Instructions and static image](docs/visual-guide.md#context)

![Attach relevant context. Sample UI demonstration.](media/guide/context.gif)

**Select and browse skills** — [Instructions and static image](docs/visual-guide.md#skills)

![Select and browse skills. Sample UI demonstration.](media/guide/skills.gif)

**Inspect a subagent and use its result** — [Instructions and static image](docs/visual-guide.md#subagents)

![Inspect a subagent and use its result. Sample UI demonstration.](media/guide/subagents.gif)

**Continue with another agent** — [Instructions and static image](docs/visual-guide.md#handoff)

![Continue with another agent. Sample UI demonstration.](media/guide/handoff.gif)

**Choose an isolated worktree** — [Instructions and static image](docs/visual-guide.md#worktrees)

![Choose an isolated worktree. Sample UI demonstration.](media/guide/worktrees.gif)

**Inspect reported usage and thread details** — [Instructions and static image](docs/visual-guide.md#usage)

![Inspect reported usage and thread details. Sample UI demonstration.](media/guide/usage.gif)

[Full user guide](docs/usage.md) — worktrees, skills, attachments, agent handoffs, terminal access, settings, and limitations.

## Local by design

Claudex runs your installed, unmodified CLIs. They keep their own authentication, settings, provider connections, and usage limits. There is no application backend, extension telemetry, or credential store.

Conversations and session references are stored locally in VS Code's workspace storage. Reloaded unfinished sessions appear as interrupted; work never restarts automatically. Only sessions created in Claudex are indexed.

Developed and tested on macOS. Windows, Linux, and remote workspaces have not yet been validated.

## License

[MIT](LICENSE). The bundled Claude Agent SDK has [separate terms](THIRD_PARTY_NOTICES.md).

## Repository

Source and issue tracking live at [thegeekyabhi/claudex](https://github.com/thegeekyabhi/claudex). The repository is private; these links require access.
