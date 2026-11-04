# Third-party notices

The MIT license in `LICENSE` covers this project's own source code only. Bundled components keep their own licenses and notices:

- React, React DOM, react-markdown, remark-gfm, Zod, cmdk, and Radix UI: MIT, including their transitive dependencies.
- Shiki: MIT, including its bundled language grammars, whose own licenses are listed in that package.
- remend: Apache-2.0.
- Lucide icons (lucide-react): ISC.
- Inter, the typeface (@fontsource-variable/inter): SIL Open Font License 1.1.

**The VSIX also includes an unmodified copy of the Anthropic Claude Agent SDK, which is not open source.** It is © Anthropic PBC, all rights reserved, and use is subject to [Anthropic's legal agreements](https://code.claude.com/docs/en/legal-and-compliance). The MIT license does not apply to it. Check those terms before redistributing a built VSIX. Its README and package metadata are under `dist/node_modules/@anthropic-ai/claude-agent-sdk/` in the VSIX.

Codex and Claude Code executables are not bundled. They must be installed and authenticated separately. This project is independently authored and is not endorsed by OpenAI, Anthropic, Cursor, Linear, or Microsoft.

The exact dependency graph is recorded in pnpm-lock.yaml.
