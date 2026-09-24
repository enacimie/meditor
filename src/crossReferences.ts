import type MarkdownIt from "markdown-it";

/**
 * Cross-references to figures, tables and equations, in pandoc-crossref's
 * syntax, so that the same `.md` refers to the same things in Pandoc.
 *
 * A label goes on what is referred to:
 *
 *     ![A dot](dot.png "The dot"){#fig:dot}
 *     : Times of the two runs {#tbl:times}
 *     $$ E = mc^2 $$ {#eq:energy}
 *
 * and a reference names it: `@fig:dot` reads "fig. 1", `@Fig:dot` "Fig. 1"
 * (to start a sentence with), `-@fig:dot` the number alone, and `[@fig:dot]`
 * the same as `@fig:dot`. Each is a link to what it names. A reference to a
 * label the document does not have is printed as **¿fig:dot?**, as
 * pandoc-crossref prints it, so that it cannot go unnoticed.
 *
 * A labelled image becomes a figure even without a title: labelling it is
 * the same act as captioning it, and its alt text becomes the caption. A
 * labelled equation is numbered, among the labelled ones, the way
 * pandoc-crossref numbers them; `$$ … $$ (1)` keeps the number written by
 * hand, and the two are not meant to be mixed.
 *
 * Not a reference: an `@` after anything but a space or an opening mark (an
 * email address, a URL), inside code, or inside a link's text, where a second
 * link cannot go. Only `fig`, `tbl` and `eq`: `@sec:intro` or a citation key
 * is left as it was written.
 */

export type CrossRefKind = "fig" | "tbl" | "eq";

type Target = { kind: CrossRefKind; number: number };

/** What the renderer keeps and is told, on markdown-it's `env`. */
type CrossRefEnv = {
  crossRefs?: Map<string, Target>;
  /** How to say "figure `n`" and the rest, in the interface language. */
  crossRefText?: (kind: CrossRefKind, n: number) => string;
};

/**
 * A label: letters and digits, with `_ : . -` inside, ending in a letter, a
 * digit or `_`, so that the full stop after "see @fig:plot." stays a full
 * stop. No lookbehind anywhere: WKWebView before Safari 16.4 cannot parse one,
 * and would drop the whole chunk.
 */
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9_:.-]*[A-Za-z0-9_])?";
const FIGURE_MARK = new RegExp(`^\\s*\\{#fig:(${LABEL})\\}\\s*$`);
const TABLE_MARK = new RegExp(`\\s*\\{#tbl:(${LABEL})\\}\\s*$`);
const EQUATION_MARK = new RegExp(`^\\s*\\{#eq:(${LABEL})\\}\\s*$`);
const REFERENCE = new RegExp(`(fig|Fig|tbl|Tbl|eq|Eq):(${LABEL})`, "y");

/** What may come right before a reference: a space, or something that opens. */
const OPENS_REFERENCE = /[\s([{"'«“‘¿¡—–]/;

/** "fig. 1", "table 1", "eq. 1": pandoc-crossref's, when nobody says otherwise. */
const DEFAULT_TEXT: Record<CrossRefKind, (n: number) => string> = {
  fig: (n) => `fig. ${n}`,
  tbl: (n) => `table ${n}`,
  eq: (n) => `eq. ${n}`,
};

function targets(env: unknown): Map<string, Target> {
  const store = env as CrossRefEnv;
  store.crossRefs ??= new Map();
  return store.crossRefs;
}

/** Line `line` of `src`, without its line break. */
function lineAt(src: string, lineStarts: number[], line: number): string {
  const start = lineStarts[line] ?? src.length;
  const next = lineStarts[line + 1];
  const end = next === undefined ? src.length : next - 1;
  return src.slice(start, end > start && src[end - 1] === "\r" ? end - 1 : end);
}

function lineStartsOf(src: string): number[] {
  const starts = [0];
  for (let at = src.indexOf("\n"); at !== -1; at = src.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

export function crossReferences(md: MarkdownIt): void {
  // A fresh set of labels for every render: `env` may be handed in again.
  md.core.ruler.before("normalize", "crossref_reset", (state) => {
    (state.env as CrossRefEnv).crossRefs = new Map();
  });

  // `$$ … $$ {#eq:x}`: texmath takes the line up to its closing `$$` and
  // drops the rest, so the label is read back from the source line itself.
  md.core.ruler.after("block", "crossref_equations", (state) => {
    let lineStarts: number[] | null = null;
    let count = 0;
    for (const token of state.tokens) {
      if (token.type !== "math_block" || !token.map) continue;
      lineStarts ??= lineStartsOf(state.src);
      const line = lineAt(state.src, lineStarts, token.map[1] - 1);
      const close = line.lastIndexOf("$$");
      const mark = close < 0 ? null : EQUATION_MARK.exec(line.slice(close + 2));
      if (!mark) continue;
      const label = `eq:${mark[1]}`;
      token.type = "math_block_eqno";
      token.info = String(++count);
      token.meta = { ...token.meta, crossRef: label };
      targets(state.env).set(label, { kind: "eq", number: count });
    }
  });

  // `: A caption {#tbl:x}`: the label comes off the caption before it is
  // parsed, and goes on the table.
  md.core.ruler.after("table_captions", "crossref_tables", (state) => {
    const tokens = state.tokens;
    for (let at = 2; at + 1 < tokens.length; at++) {
      if (tokens[at].type !== "table_label" || tokens[at - 2].type !== "table_open") continue;
      const caption = tokens[at + 1];
      const mark = TABLE_MARK.exec(caption.content);
      if (!mark) continue;
      caption.content = caption.content.slice(0, mark.index);
      const label = `tbl:${mark[1]}`;
      tokens[at - 2].attrSet("id", label);
      targets(state.env).set(label, { kind: "tbl", number: (tokens[at].meta as { number: number }).number });
    }
  });

  // `![alt](src "caption"){#fig:x}`: the label is taken off, so that the
  // paragraph holds the image alone and the figures rule makes it a figure.
  md.core.ruler.before("figures", "crossref_figure_labels", (state) => {
    const tokens = state.tokens;
    for (let at = 0; at + 2 < tokens.length; at++) {
      if (tokens[at].type !== "paragraph_open" || tokens[at + 2].type !== "paragraph_close") continue;
      const inline = tokens[at + 1];
      if (inline.type !== "inline") continue;
      const children = inline.children ?? [];
      const shown = children.filter((child) => !(child.type === "text" && child.content.trim() === ""));
      if (shown.length !== 2 || shown[0].type !== "image" || shown[1].type !== "text") continue;
      const mark = FIGURE_MARK.exec(shown[1].content);
      if (!mark) continue;
      const image = shown[0];
      image.meta = { ...image.meta, crossRef: `fig:${mark[1]}` };
      // Labelled is captioned: the alt text is the caption when there is no title.
      if (!(image.attrGet("title") ?? "").trim() && image.content.trim()) {
        image.attrSet("title", image.content.trim());
      }
      inline.children = children.filter((child) => child !== shown[1]);
    }
  });

  // After the figures rule: the number it gave, and the figure's id.
  md.core.ruler.push("crossref_figures", (state) => {
    const tokens = state.tokens;
    for (let at = 1; at < tokens.length; at++) {
      const children = tokens[at].children;
      if (tokens[at].type !== "inline" || !children) continue;
      const caption = children.find((child) => child.type === "figure_caption");
      const image = children.find((child) => child.type === "image");
      const label = (image?.meta as { crossRef?: string } | undefined)?.crossRef;
      if (!caption || !label) continue;
      tokens[at - 1].attrSet("id", label);
      targets(state.env).set(label, { kind: "fig", number: (caption.meta as { number: number }).number });
    }
  });

  // The references: before `link`, so that `[@fig:x]` is one, and after
  // `backticks`, so that code is not.
  md.inline.ruler.before("link", "crossref", (state, silent) => {
    // Inside a link's text. markdown-it keeps the count (its `link` rule
    // raises it, `linkify` reads it); its type definitions leave it out.
    if ((state as typeof state & { linkLevel: number }).linkLevel > 0) return false;
    const src = state.src;
    const start = state.pos;
    let pos = start;
    const bracket = src.charCodeAt(pos) === 0x5b; // [
    if (bracket) pos++;
    const suppress = src.charCodeAt(pos) === 0x2d; // -
    if (suppress) pos++;
    if (src.charCodeAt(pos) !== 0x40) return false; // @
    if (start > 0 && !OPENS_REFERENCE.test(src[start - 1])) return false;
    REFERENCE.lastIndex = pos + 1;
    const match = REFERENCE.exec(src);
    if (!match) return false;
    let end = REFERENCE.lastIndex;
    if (bracket) {
      // `[@fig:x](url)` is a link whose text is a reference, not a reference.
      if (src.charCodeAt(end) !== 0x5d || src.charCodeAt(end + 1) === 0x28) return false;
      end++;
    }
    if (!silent) {
      const token = state.push("crossref", "", 0);
      token.meta = {
        label: `${match[1].toLowerCase()}:${match[2]}`,
        kind: match[1].toLowerCase() as CrossRefKind,
        capital: match[1][0] !== match[1][0].toLowerCase(),
        suppress,
      };
    }
    state.pos = end;
    return true;
  });

  md.renderer.rules.crossref = (tokens, idx, _options, env) => {
    const { label, kind, capital, suppress } = tokens[idx].meta as {
      label: string;
      kind: CrossRefKind;
      capital: boolean;
      suppress: boolean;
    };
    const escape = md.utils.escapeHtml;
    const target = (env as CrossRefEnv).crossRefs?.get(label);
    if (!target) return `<strong class="crossref-missing">¿${escape(label)}?</strong>`;
    let text = suppress
      ? String(target.number)
      : ((env as CrossRefEnv).crossRefText ?? ((k, n) => DEFAULT_TEXT[k](n)))(kind, target.number);
    if (capital && !suppress) text = text.charAt(0).toUpperCase() + text.slice(1);
    return `<a class="crossref" href="#${escape(label)}">${escape(text)}</a>`;
  };

  // A labelled equation's `<section>` carries the label as its id.
  const equation = md.renderer.rules.math_block_eqno;
  md.renderer.rules.math_block_eqno = (tokens, idx, options, env, self) => {
    const html = equation ? equation(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    const label = (tokens[idx].meta as { crossRef?: string } | null)?.crossRef;
    return label
      ? html.replace(/^<section class="eqno"/, `<section class="eqno" id="${md.utils.escapeHtml(label)}"`)
      : html;
  };
}
