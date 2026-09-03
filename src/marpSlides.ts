/**
 * Map each slide of a Marp deck to the source line it starts on, so the
 * preview can sync back to the editor at slide granularity.
 *
 * Marp breaks slides on top-level thematic breaks. Deciding which `---` lines
 * those are is markdown's job, not a regular expression's, and scanning line
 * by line got two spellings wrong — both of which Marp renders as one slide
 * while the scan reported two:
 *
 *     Some text        `---` directly under a paragraph line is the underline
 *     ---              of a setext heading. CommonMark gives the heading
 *                      precedence, so Marp never breaks here.
 *
 *     - item           Indented under a list item, the break belongs to the
 *                      list. The old scan allowed up to three spaces of
 *       ---            indentation and could not tell the difference.
 *
 * Every slide after such a line was mapped to the wrong source line, so
 * clicking a slide jumped to the wrong place in the editor — and, since the
 * presenter reads its per-slide transitions off the same split, each slide
 * from there on animated with its neighbour's.
 *
 * The rules that decide this are not worth re-deriving: `---` under a heading
 * or a list *item* is a break, `- - -` spaced out cannot be a setext underline
 * and so is one too. Ask the parser instead.
 */
import MarkdownIt from "markdown-it";

/*
 * Configured the way marp-core configures its own: the `commonmark` preset,
 * plus `table`, `linkify`, `strikethrough`, `replacements` and `smartquotes`.
 * Only `table` is a block rule, so it is the only one that can move where a
 * block starts; the others are inline or typographic and cannot change which
 * lines are thematic breaks.
 */
const md = new MarkdownIt("commonmark").enable(["table"]);

export function slideStartLines(content: string): number[] {
  const src = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = src.split(/\r?\n/);

  /*
   * The YAML front-matter belongs to Marpit, not to markdown: to a markdown
   * parser the closing `---` is just the setext underline of `marp: true`.
   * Find where it ends first and hand the parser only what follows.
   */
  let index = 0;
  if (lines.length && lines[0].trim() === "---") {
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "---" || t === "...") {
        index = j + 1;
        break;
      }
    }
  }

  const starts: number[] = [Math.min(index, Math.max(lines.length - 1, 0))];
  for (const token of md.parse(lines.slice(index).join("\n"), {})) {
    // Top level only: an `hr` nested in a list or a blockquote is part of that
    // block, and Marpit starts no slide there. A `---` inside a fence never
    // becomes an `hr` in the first place, so that case now costs nothing.
    if (token.type === "hr" && token.level === 0 && token.map) {
      starts.push(index + token.map[0] + 1);
    }
  }
  return starts;
}
