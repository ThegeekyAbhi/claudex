# Install at least one agent

Claudex doesn't include a model. It runs the CLIs already installed on this machine, with your own accounts and plans.

| Agent | Install | Docs |
| --- | --- | --- |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | [Setup guide](https://docs.anthropic.com/en/docs/claude-code/setup) |
| Codex | `npm install -g @openai/codex` | [Repository](https://github.com/openai/codex) |

After installing, choose **Check my agents**. If a CLI is installed somewhere unusual, set `agentWorkspace.claudePath` or `agentWorkspace.codexPath` in Settings.
