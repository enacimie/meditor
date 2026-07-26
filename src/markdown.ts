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
import highlightjs from "markdown-it-highlightjs";
import katex from "katex";

function addLineNumbers(md: MarkdownIt) {
  md.core.ruler.push("add_line_numbers", (state) => {
    for (const token of state.tokens) {
      if (token.map && token.map.length && token.type.endsWith("_open")) {
        token.attrSet("data-line", String(token.map[0]));
      }
    }
  });
}

export const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})
  .use(highlightjs)
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
  .use(addLineNumbers);

const highlightFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const html = highlightFence
    ? highlightFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  if (token.map && token.map.length) {
    return html.replace(/^<pre/, `<pre data-line="${token.map[0]}"`);
  }
  return html;
};

export function renderMarkdown(src: string): string {
  return md.render(src);
}
