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

![New chat with the message box, mode and model controls, attachment button, and local folder selector.](media/guide/start.png)

### 2. Review a plan, then build

Select **Plan** and describe the task. When the **Created plan** card appears, click **View Plan** to read it. Use **Open as text** to edit the Markdown, or reply in chat to request changes. Click **Implement plan** when ready; it reads your latest edits and switches the thread to Auto.

![Created plan card with View Plan and Implement plan actions.](media/guide/plan.png)

### 3. Review requests and changes

When a request appears, read the command or action, then choose **Allow once** or **Decline**. Open **Changes** in the header to see uncommitted files in the thread's checkout. Click a file to open VS Code's diff editor.

![Approval request with Allow once and Decline, alongside the Changes panel listing a changed file.](media/guide/review.png)

Use the tabs or **Chats** to return to a thread. Closing a tab keeps the conversation and any running work. To continue with another agent, choose it from the model menu, inspect the **Context from …** chip, and press Enter to send.

[Full user guide](docs/usage.md) — worktrees, skills, attachments, agent handoffs, terminal access, settings, and limitations.

## Local by design

Claudex runs your installed, unmodified CLIs. They keep their own authentication, settings, provider connections, and usage limits. There is no application backend, extension telemetry, or credential store.

Conversations and session references are stored locally in VS Code's workspace storage. Reloaded unfinished sessions appear as interrupted; work never restarts automatically. Only sessions created in Claudex are indexed.

Developed and tested on macOS. Windows, Linux, and remote workspaces have not yet been validated.

## License

[MIT](LICENSE). The bundled Claude Agent SDK has [separate terms](THIRD_PARTY_NOTICES.md).

## Repository

Source and issue tracking live at [thegeekyabhi/claudex](https://github.com/thegeekyabhi/claudex). The repository is private; these links require access.
