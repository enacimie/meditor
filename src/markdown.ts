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

// Mermaid blocks are rendered separately, by mermaidRender.
// Register a no-op language so highlight.js doesn't warn about unknown "mermaid".
const mermaidNoop = () => ({
  name: "Mermaid",
  contains: [],
});

/*
 * YAML front-matter is metadata, and metadata is not prose.
 *
 * A block of `key: value` lines fenced by `---` at the very top of a file is
 * how Hugo, Jekyll, Pandoc, Obsidian and Zettlr carry a document's title,
 * author and date, and Markdown itself has no idea what it is: the opening
 * `---` parses as a horizontal rule and the lines under it as a setext
 * heading, so the whole block arrived in the preview — and in the PDF — as a
 * rule followed by the raw YAML set in heading type.
 *
 * meditor already reads front-matter in two places (`marpDetect` for
 * `marp: true`, `marpPresent` for slide transitions), so a document that has
 * it is expected here. This rule only keeps it out of the rendered output;
 * nothing yet reads a title or an author from it.
 *
 * Deliberately narrow, because a leading `---` is also a legitimate horizontal
 * rule. The fence must open on the very first line, must be closed, and the
 * line straight after it must read like YAML — a `key:` or a comment. Without
 * that last condition a document that opens with a decorative rule, carries a
 * paragraph and then rules off again loses the paragraph in between: the two
 * rules look exactly like a fence, and everything between them disappears.
 * An unterminated fence, or one full of prose, still renders as it always did.
 */
/** The first line of real front-matter: a YAML key, or a comment above one. */
const YAML_FIRST_LINE = /^(?:#|[^\s:#][^:]*:(?:\s|$))/;
function frontMatter(md: MarkdownIt) {
  md.block.ruler.before(
    "hr",
    "front_matter",
    (state, startLine, endLine, silent) => {
      // The very top of the document, and nowhere else. Indented, it is a
      // code block; further down, it is a rule between two paragraphs.
      if (startLine !== 0 || state.blkIndent !== 0 || state.sCount[startLine] !== 0) {
        return false;
      }
      const open = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]).trim();
      if (open !== "---") return false;

      const next = startLine + 1;
      const firstLine =
        next < endLine
          ? state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]).trim()
          : "";
      if (!YAML_FIRST_LINE.test(firstLine)) return false;

      for (let line = startLine + 1; line < endLine; line++) {
        const text = state.src
          .slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
          .trim();
        if (text !== "---" && text !== "...") continue;
        if (silent) return true;
        // Consumed and dropped: no token, so nothing renders and the
        // `data-line` of everything below is untouched.
        state.line = line + 1;
        return true;
      }
      // Never closed, so it was a horizontal rule after all.
      return false;
    },
    { alt: ["paragraph", "reference", "blockquote"] },
  );
}

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
/*
 * Ids on headings, so a link to one inside the document arrives somewhere.
 *
 * `[the reading view](#the-reading-view)` is ordinary Markdown and works
 * everywhere it is published — GitHub, GitLab, a static site — and until now
 * it did nothing here: no heading carried an id, so the click found no target
 * and quietly did nothing. The Outline could already jump; a link written into
 * the prose could not.
 *
 * Written here rather than pulled in, for the same reason the numbered
 * paragraphs above are: it is thirty lines, the rules have to be ours anyway,
 * and the file is already the one place this pipeline is described.
 *
 * The slug follows GitHub's, which is the one people's existing documents are
 * written against: lower case, punctuation dropped, spaces to hyphens, and a
 * numeric suffix when a title repeats. Letters outside ASCII are kept rather
 * than stripped — a document written in Spanish, Greek or Arabic would
 * otherwise have every heading collapse to the same empty slug, and #sección
 * is what GitHub itself produces.
 */
/** The ids `markdown-it-footnote` generates for notes and their back-links. */
const FOOTNOTE_ID = /^fn(ref)?\d+$/;

function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      // Punctuation and symbols go; letters, numbers, marks and the two
      // characters GitHub keeps stay.
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
      .replace(/ +/g, "-")
  );
}

function headingAnchors(md: MarkdownIt) {
  md.core.ruler.push("heading_anchors", (state) => {
    const used = new Map<string, number>();
    for (let i = 0; i < state.tokens.length; i++) {
      const open = state.tokens[i];
      if (open.type !== "heading_open") continue;
      const inline = state.tokens[i + 1];
      if (!inline || inline.type !== "inline") continue;
      // `children` rather than `content`, so the id comes from the words a
      // reader sees: emphasis markers, link syntax and inline code fences are
      // not part of the title as it is read.
      const text = (inline.children ?? [])
        .filter((child) => child.type === "text" || child.type === "code_inline")
        .map((child) => child.content)
        .join("");
      const base = slugify(text);
      if (!base) continue;
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      // A repeated title gets a numeric suffix, as it does on GitHub, so the
      // second "Notes" is `#notes-1` and both are reachable.
      let id = seen === 0 ? base : `${base}-${seen}`;
      // The footnote plugin owns `fn1` and `fnref1`. A heading that slugs to
      // one of those would put a second element under the same id and take
      // over where a footnote's back-link lands, so it steps aside instead.
      if (FOOTNOTE_ID.test(id)) id = `${id}-heading`;
      if (!open.attrGet("id")) open.attrSet("id", id);
    }
  });
}

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
  .use(frontMatter)
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
  .use(headingAnchors)
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
