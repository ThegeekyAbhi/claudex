# Claudex visual guide

[Overview](../README.md) · [Full reference](usage.md)

Short demonstrations of the current UI, using clearly labeled sample conversations. No live provider calls are made. Reading pauses are edited for clarity; these clips do not measure agent response times. Each guide includes written instructions and a static final frame.

[Add and switch multiple accounts](usage.md#multiple-accounts)

- [Choose Ask, Plan, or Auto](#modes)
- [Choose a model and reasoning effort](#models)
- [Read rich answers in Ask mode](#ask-markdown)
- [Understand diagrams and visual explanations](#visual-explanations)
- [Review and implement a plan](#planning)
- [Answer agent questions](#questions)
- [Review approval requests](#approvals)
- [Inspect changed files](#changes)
- [Keep multiple chats and find past work](#chats-history)
- [Attach relevant context](#context)
- [Select and browse skills](#skills)
- [Inspect a subagent and use its result](#subagents)
- [Continue with another agent](#handoff)
- [Choose an isolated worktree](#worktrees)
- [Inspect reported usage and thread details](#usage)

<a id="modes"></a>

## Choose Ask, Plan, or Auto

Open the mode menu beside the composer. Choose **Ask** to explore, **Plan** to prepare an approach, or **Auto** to work with the installed CLI’s approval settings. The displayed mode reflects provider support. Claude Ask disables edit tools but can still run shell commands allowed by your Claude settings.

![Choose Ask, Plan, or Auto. Sample UI demonstration.](../media/guide/modes.gif)

[Static image](../media/guide/modes.png)

<a id="models"></a>

## Choose a model and reasoning effort

Open the model selector and search the available models. Choose one, then use the separate effort menu to select a supported reasoning level. **Default** preserves the installed CLI’s configuration. Selecting a model or effort does not send your draft.

![Search models and select reasoning effort. Sample UI demonstration.](../media/guide/models.gif)

[Static image](../media/guide/models.png)

<a id="ask-markdown"></a>

## Read rich answers in Ask mode

Choose **Ask** and describe what you want to understand. Responses can include headings, tables, highlighted code, and notes. Use the **Visual explanations** toggle to control the additional guidance for illustrated answers.

![Read rich answers in Ask mode. Sample UI demonstration.](../media/guide/ask-markdown.gif)

[Static image](../media/guide/ask-markdown.png)

<a id="visual-explanations"></a>

## Understand diagrams and visual explanations

Ask for a diagram when relationships are easier to see than read. Mermaid diagrams and sandboxed HTML or SVG visuals render in the conversation. Visuals cannot run scripts or fetch network content.

![Understand diagrams and visual explanations. Sample UI demonstration.](../media/guide/visual-explanations.gif)

[Static image](../media/guide/visual-explanations.png)

<a id="planning"></a>

## Review and implement a plan

Choose **Plan** before sending your task. Review the plan inline, then use **Open plan** or **Edit plan** to read or edit its Markdown in VS Code. Add notes in the composer and choose **Implement in Auto**, or open **More ways to continue** for other supported choices. Implementation reads the latest saved plan. This browser clip shows the editor request and implementation controls; it does not depict the native editor or agent execution.

![Review and implement a plan. Sample UI demonstration.](../media/guide/planning.gif)

[Static image](../media/guide/planning.png)

<a id="questions"></a>

## Answer agent questions

Choose an option in the docked question card and continue to the next question. Type a written answer when requested. Submit the final answer to return all responses to the agent. Keyboard shortcuts are also available; Esc skips and reports that you declined.

![Answer agent questions. Sample UI demonstration.](../media/guide/questions.gif)

[Static image](../media/guide/questions.png)

<a id="approvals"></a>

## Review approval requests

Read the action and command before choosing **Allow once** or **Decline**. Allow once applies to that request. The guide shows two separate sample requests; no command executes during capture.

![Review approval requests. Sample UI demonstration.](../media/guide/approvals.gif)

[Static image](../media/guide/approvals.png)

<a id="changes"></a>

## Inspect changed files

Open **Changes** in the header, filter the file list, and select a file to open VS Code’s native Changes editor. **Review all** opens the entire set. The list covers uncommitted changes in the thread’s checkout and does not establish authorship. This clip stops at the native editor request; the editor itself is outside the webview.

![Inspect changed files. Sample UI demonstration.](../media/guide/changes.gif)

[Static image](../media/guide/changes.png)

<a id="chats-history"></a>

## Keep multiple chats and find past work

Use **+** to open separate chats. Switch tabs to return to an unsent draft. Search **Chats** to find past tasks or use **Running only** to narrow the list. Closing a tab preserves its conversation and does not stop running work. Interrupted work does not restart automatically.

![Keep multiple chats and find past work. Sample UI demonstration.](../media/guide/chats-history.gif)

[Static image](../media/guide/chats-history.png)

<a id="context"></a>

## Attach relevant context

Type **@** in the composer to browse files, folders, past threads, terminals, branch changes, and images. Choose a recent file to add it to your draft. Use **#** to go directly to files. Review the selected context before sending.

![Attach relevant context. Sample UI demonstration.](../media/guide/context.gif)

[Static image](../media/guide/context.png)

<a id="skills"></a>

## Select and browse skills

Type **/** to search skills available to the current account, then choose one to add a removable chip. A selected chip is a request to use a skill; only a reported tool call establishes actual use. Choose **Manage skills…** to browse instructions. Installation remains with your CLI.

![Select and browse skills. Sample UI demonstration.](../media/guide/skills.gif)

[Static image](../media/guide/skills.png)

<a id="subagents"></a>

## Inspect a subagent and use its result

Request a child agent with a leading agent mention or explicitly ask the current agent to run one. The child’s task and result appear in a card and nested thread. Choose **Add this result** to carry a result into your next message. Open the child thread to inspect its own conversation. This sample starts with a completed child; it does not demonstrate a live run or automatic delegation.

![Inspect a subagent and use its result. Sample UI demonstration.](../media/guide/subagents.gif)

[Static image](../media/guide/subagents.png)

<a id="handoff"></a>

## Continue with another agent

On a finished thread, open **More actions → Continue in** and select another agent or profile. Your draft moves with a **Context from …** chip. Click the chip to preview what will be sent in VS Code, or remove it. Nothing sends until you press Enter. This guide shows UI selection only and does not invoke Claude.

![Continue with another agent. Sample UI demonstration.](../media/guide/handoff.gif)

[Static image](../media/guide/handoff.png)

<a id="worktrees"></a>

## Choose an isolated worktree

On a new chat, open the location menu and choose **New worktree** before sending the task. The worktree starts from committed HEAD; uncommitted files are not copied. Claudex does not automatically merge or clean up worktrees. This guide selects the location without starting work.

![Choose an isolated worktree. Sample UI demonstration.](../media/guide/worktrees.gif)

[Static image](../media/guide/worktrees.png)

<a id="usage"></a>

## Inspect reported usage and thread details

Click the context and usage indicator near the composer to see the CLI’s reported context and usage windows. Expand **Details** to inspect the mode, MCP servers, and instruction files when reported. These values are sample data; the indicator stays hidden when no usage has been reported.

![Inspect reported usage and thread details. Sample UI demonstration.](../media/guide/usage.gif)

[Static image](../media/guide/usage.png)
