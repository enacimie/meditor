/**
 * Marp rendering engine.
 *
 * Heavy by design (marp-core + KaTeX markup), so nothing here is imported
 * eagerly: MarpPreview pulls this module in through a lazy chunk, and a plain
 * Markdown document never pays for it.
 *
 * The instance reuses what meditor already ships instead of Marp's optional
 * bundles: code fences are highlighted with the app's highlight.js (not Shiki)
 * and math is rendered by the KaTeX plugin using meditor's own KaTeX CSS, so
 * the plugin's CDN `@font-face` rules are stripped from the output.
 */
import "./marpPolyfill";
import { Marp } from "@marp-team/marp-core";
import katexPlugin from "@marp-team/marp-core/plugins/katex";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import ruby from "highlight.js/lib/languages/ruby";
import yaml from "highlight.js/lib/languages/yaml";
import dockerfile from "highlight.js/lib/languages/dockerfile";

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  javascript,
  typescript,
  json,
  bash,
  css,
  xml,
  markdown: markdownLanguage,
  python,
  rust,
  sql,
  c,
  cpp,
  java,
  go,
  ruby,
  yaml,
  dockerfile,
};

const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  html: "xml",
  xhtml: "xml",
  svg: "xml",
  md: "markdown",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
  yml: "yaml",
  docker: "dockerfile",
};

// highlight.js/lib/core is a singleton shared with the Markdown pipeline, so
// only register what is not there yet.
for (const [name, definition] of Object.entries(LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, definition);
}

function highlight(code: string, info: string): string {
  const id = (info || "").trim().split(/\s+/)[0].toLowerCase();
  // A mermaid fence stays a plain `code.language-mermaid` block: the preview
  // post-processes those into diagrams with meditor's own Mermaid, whatever
  // highlight.js happens to have registered under that name.
  if (id === "mermaid") return "";
  const name = ALIASES[id] ?? id;
  if (name && hljs.getLanguage(name)) {
    try {
      return hljs.highlight(code, { language: name }).value;
    } catch {
      return "";
    }
  }
  return "";
}

const marp = new Marp({
  // The browser helper is applied by the component, not an injected <script>.
  script: false,
  math: "katex",
  markdown: { highlight },
}).use(katexPlugin({ fontPath: false }));

const FONT_FACE = /@font-face\s*\{[^}]*\}/g;

/**
 * A rendered Mermaid diagram is an `<svg>` of its own size inside a slide, so
 * keep it inside the sheet: cap it at the slide width and centre it. Covers
 * the transient loading/error placeholders too.
 */
const MERMAID_FIT_CSS = `
div.marpit .mermaid,div.marpit .mermaid-loading,div.marpit .mermaid-error{max-width:100%;text-align:center}
div.marpit .mermaid svg{max-width:100%;height:auto}
`;

/** Render a Marp deck to slide HTML and scoped CSS. */
export function renderMarp(markdown: string): { html: string; css: string } {
  const { html, css } = marp.render(markdown);
  // KaTeX fonts come from meditor's own katex.min.css (Vite-resolved, works
  // offline); drop the plugin's CDN/relative @font-face rules.
  return { html, css: css.replace(FONT_FACE, "") + MERMAID_FIT_CSS };
}
