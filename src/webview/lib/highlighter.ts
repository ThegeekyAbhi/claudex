import { createHighlighterCoreSync, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from 'shiki/langs/bash.mjs';
import c from 'shiki/langs/c.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import csharp from 'shiki/langs/csharp.mjs';
import css from 'shiki/langs/css.mjs';
import diff from 'shiki/langs/diff.mjs';
import dockerfile from 'shiki/langs/dockerfile.mjs';
import go from 'shiki/langs/go.mjs';
import html from 'shiki/langs/html.mjs';
import ini from 'shiki/langs/ini.mjs';
import java from 'shiki/langs/java.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import kotlin from 'shiki/langs/kotlin.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import php from 'shiki/langs/php.mjs';
import python from 'shiki/langs/python.mjs';
import ruby from 'shiki/langs/ruby.mjs';
import rust from 'shiki/langs/rust.mjs';
import scss from 'shiki/langs/scss.mjs';
import sql from 'shiki/langs/sql.mjs';
import swift from 'shiki/langs/swift.mjs';
import toml from 'shiki/langs/toml.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import xml from 'shiki/langs/xml.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import darkPlus from 'shiki/themes/dark-plus.mjs';
import lightPlus from 'shiki/themes/light-plus.mjs';

/**
 * VS Code's own Dark+ and Light+ colours. Every token carries both; the stylesheet picks one for
 * the editor's theme, and high contrast themes use plain text.
 */
export const THEMES = { light: 'light-plus', dark: 'dark-plus' } as const;
export const highlighter: HighlighterCore = createHighlighterCoreSync({
  themes: [darkPlus, lightPlus],
  langs: [
    bash,
    c,
    cpp,
    csharp,
    css,
    diff,
    dockerfile,
    go,
    html,
    ini,
    java,
    javascript,
    json,
    jsx,
    kotlin,
    markdown,
    php,
    python,
    ruby,
    rust,
    scss,
    sql,
    swift,
    toml,
    tsx,
    typescript,
    xml,
    yaml,
  ],
  engine: createJavaScriptRegexEngine(),
});
/** Each theme's plain text colour. Tokens in it are left to the page's own code colour. */
export const PLAIN = {
  light: highlighter.getTheme(THEMES.light).fg.toLowerCase(),
  dark: highlighter.getTheme(THEMES.dark).fg.toLowerCase(),
};
