# Agent Workspace

This is an independent personal VS Code extension. Do not modify Veeby or infer any dependency on that video editor.

Keep agent behavior inside installed, unmodified Codex and Claude Code. Do not add a model API integration, credential handling, hosted backend, automatic delegation loop, or permission bypass. Provider adapters belong in src/providers; the webview must not use Node or vscode APIs. Validate all incoming webview messages. Keep agent-authored documents as ordinary Markdown.

Use pnpm 10.33.2 and preserve pnpm-lock.yaml. Run pnpm check for code changes. pnpm test:ui starts a local server and headless browser. pnpm smoke performs real provider calls and consumes normal user quota; run only when live integration testing is authorized. pnpm package builds the VSIX.

Keep failed or interrupted states truthful. Never infer completed work from tool exit alone or task checkboxes. Do not grant unsupported provider requests. Preserve local session IDs and do not automatically restart work on extension activation.
