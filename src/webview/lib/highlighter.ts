import {
  createCssVariablesTheme,
  createHighlighterCoreSync,
  type HighlighterCore,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from 'shiki/langs/bash.mjs';
import css from 'shiki/langs/css.mjs';
import diff from 'shiki/langs/diff.mjs';
import go from 'shiki/langs/go.mjs';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import python from 'shiki/langs/python.mjs';
import rust from 'shiki/langs/rust.mjs';
import sql from 'shiki/langs/sql.mjs';
import swift from 'shiki/langs/swift.mjs';
import toml from 'shiki/langs/toml.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import yaml from 'shiki/langs/yaml.mjs';

/** Colors come from CSS variables, so code follows the light, dark, and high-contrast tokens. */
export const THEME = 'agent-workspace';
export const highlighter: HighlighterCore = createHighlighterCoreSync({
  themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--code-' })],
  langs: [
    bash,
    css,
    diff,
    go,
    html,
    javascript,
    json,
    jsx,
    markdown,
    python,
    rust,
    sql,
    swift,
    toml,
    tsx,
    typescript,
    yaml,
  ],
  engine: createJavaScriptRegexEngine(),
});
