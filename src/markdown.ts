import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import ins from "markdown-it-ins";
import deflist from "markdown-it-deflist";
import abbr from "markdown-it-abbr";
import { full as emoji } from "markdown-it-emoji";
import container from "markdown-it-container";
import texmath from "markdown-it-texmath";
import highlightjs from "markdown-it-highlightjs/core";
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
import katex from "katex";

// Mermaid blocks are rendered separately by the mermaid worker/pool.
// Register a no-op language so highlight.js doesn't warn about unknown "mermaid".
const mermaidNoop = () => ({
  name: "Mermaid",
  contains: [],
});

function addLineNumbers(md: MarkdownIt) {
  md.core.ruler.push("add_line_numbers", (state) => {
    for (const token of state.tokens) {
      if (token.map && token.map.length && token.type.endsWith("_open")) {
        token.attrSet("data-line", String(token.map[0]));
      }
    }
  });
}

/*
 * A paragraph that opens with a bold number — `**1.** Some text` — is not a
 * list to Markdown, and cannot be: a list marker is `1.` followed by a space
 * at the start of a line, and wrapping it in asterisks makes it emphasis
 * instead. Every other renderer agrees, so the parse stays as it is.
 *
 * What it is, though, is how people hand-number paragraphs that carry other
 * paragraphs in between — replies in a script, notes between steps — which a
 * real list cannot hold without swallowing them. Those paragraphs then take
 * prose indentation: the first one flush and the rest indented, so the first
 * number hangs out to the left of its own siblings.
 *
 * So they are tagged here and given a list's geometry in the Document view.
 * Only the styling changes; the HTML is still a paragraph, and the Markdown
 * still means what it means everywhere else.
 */
const BOLD_ORDINAL = /^\d{1,3}[.)]$/;

function markNumberedParagraphs(md: MarkdownIt) {
  md.core.ruler.push("mark_numbered_paragraphs", (state) => {
    for (let i = 0; i < state.tokens.length - 1; i++) {
      const open = state.tokens[i];
      if (open.type !== "paragraph_open") continue;
      const children = state.tokens[i + 1].children;
      if (!children) continue;
      // An inline run can open with an empty text token, so the emphasis is
      // not reliably the first child — find where the content actually starts.
      const start = children.findIndex((c) => c.type !== "text" || c.content !== "");
      if (start === -1 || children.length < start + 3) continue;
      // Three digits at most, so a paragraph opening on a bold year —
      // "**2024.** It was a difficult year" — stays ordinary prose.
      if (
        children[start].type === "strong_open" &&
        children[start + 1].type === "text" &&
        BOLD_ORDINAL.test(children[start + 1].content.trim()) &&
        children[start + 2].type === "strong_close"
      ) {
        open.attrJoin("class", "numbered-paragraph");
      }
    }
  });
}

export const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})
  .use(highlightjs, {
    hljs,
    auto: true,
    code: true,
    register: {
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
      mermaid: mermaidNoop,
    },
    registerAliases: {
      javascript: ["js", "jsx"],
      typescript: ["ts", "tsx"],
      bash: ["sh", "shell", "zsh"],
      xml: ["html", "xhtml", "svg"],
      markdown: ["md"],
      cpp: ["c++", "cc", "cxx", "h", "hpp"],
      yaml: ["yml"],
      dockerfile: ["docker"],
    },
  })
  .use(taskLists, { enabled: true })
  .use(footnote)
  .use(mark)
  .use(sub)
  .use(sup)
  .use(ins)
  .use(deflist)
  .use(abbr)
  .use(emoji)
  .use(texmath, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { throwOnError: false },
  })
  .use(container, "warning")
  .use(container, "note")
  .use(markNumberedParagraphs)
  .use(addLineNumbers);

const highlightFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const html = highlightFence
    ? highlightFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  if (token.map && token.map.length) {
    const marked = html.replace(/^<pre/, `<pre data-line="${token.map[0]}"`);
    return marked === html
      ? html.replace(/^<([a-z]+)/, `<$1 data-line="${token.map[0]}"`)
      : marked;
  }
  return html;
};

export function renderMarkdown(src: string): string {
  return md.render(src);
}
