import type MarkdownIt from "markdown-it";

/**
 * Numbered table captions, in Pandoc's syntax.
 *
 * A paragraph that begins with `Table:` or `:` and sits right before or right
 * after a table is that table's caption:
 *
 *     : Results of the second run.
 *
 *     | Run | Time |
 *     | --- | ---- |
 *     | 2   | 41 s |
 *
 * It becomes the table's `<caption>`, numbered like the figures ("Table 1."),
 * above the table as LaTeX sets one. Pandoc's precedence is kept: a caption
 * before a table wins over one after it, and a caption between two tables
 * belongs to the first, unless the first already has one of its own before
 * it.
 *
 * The caption keeps its inline Markdown, since it was a paragraph, and no
 * `data-line`: one written after its table is drawn above the rows, and a
 * line number there would be out of order with the rest of the document.
 *
 * `:` straight after an ordinary paragraph is a definition list
 * (markdown-it-deflist), not a caption; `Table:` is a caption wherever it is.
 */

/** `Table:`, `table:` or a bare `:`, and the space after it. */
const CAPTION = /^(?:Table|table)?:[ \t]+/;

type Tokens = MarkdownIt["core"]["State"]["prototype"]["tokens"];

/**
 * Whether the tokens at `at` are a caption paragraph. Right next to a table,
 * it can only be at the table's own level: anything that opened a level
 * between them would have left a token in the way.
 */
function isCaption(tokens: Tokens, at: number): boolean {
  return (
    tokens[at]?.type === "paragraph_open" &&
    tokens[at + 1]?.type === "inline" &&
    tokens[at + 2]?.type === "paragraph_close" &&
    CAPTION.test(tokens[at + 1].content)
  );
}

/** Where the table opened at `open` closes. */
function tableEnd(tokens: Tokens, open: number): number {
  const level = tokens[open].level;
  let at = open + 1;
  while (at < tokens.length && !(tokens[at].type === "table_close" && tokens[at].level === level)) at++;
  return at;
}

export function tableCaptions(md: MarkdownIt): void {
  // Before `inline`, so the caption is parsed as inline Markdown only once,
  // with its `Table:` already taken off.
  md.core.ruler.before("inline", "table_captions", (state) => {
    const tokens = state.tokens;
    let count = 0;
    for (let at = 0; at < tokens.length; at++) {
      if (tokens[at].type !== "table_open") continue;
      const level = tokens[at].level;
      let caption: number;
      if (at >= 3 && isCaption(tokens, at - 3)) {
        caption = at - 3;
      } else {
        const after = tableEnd(tokens, at) + 1;
        if (!isCaption(tokens, after)) continue;
        caption = after;
      }

      const [, inline] = tokens.splice(caption, 3);
      if (caption < at) at -= 3;
      inline.content = inline.content.replace(CAPTION, "");
      inline.level = level + 2;

      const open = new state.Token("table_caption_open", "caption", 1);
      open.level = level + 1;
      const label = new state.Token("table_label", "", 0);
      label.meta = { number: ++count };
      const close = new state.Token("table_caption_close", "caption", -1);
      close.level = level + 1;
      tokens.splice(at + 1, 0, open, label, inline, close);
    }
  });

  md.renderer.rules.table_label = (tokens, idx, _options, env) => {
    const number = (tokens[idx].meta as { number: number }).number;
    const label = (env as { tableLabel?: (n: number) => string })?.tableLabel;
    const text = label ? label(number) : `Table ${number}.`;
    return `<span class="table-label">${md.utils.escapeHtml(text)}</span> `;
  };
}
