import { describe, expect, it } from "vitest";
import { slideStartLines } from "./marpSlides";

describe("slideStartLines", () => {
  it("starts the first slide right after the front-matter", () => {
    const src = "---\nmarp: true\n---\n\n# One\n\n---\n\n## Two\n";
    expect(slideStartLines(src)).toEqual([3, 7]);
  });

  it("does not count the front-matter delimiters as separators", () => {
    const src = "---\nmarp: true\ntheme: gaia\n---\n# Only slide\n";
    expect(slideStartLines(src)).toEqual([4]);
  });

  it("ignores --- inside fenced code", () => {
    const src = "---\nmarp: true\n---\n\n```\ninside\n---\nstill\n```\n\n---\n\n## Next\n";
    expect(slideStartLines(src)).toEqual([3, 11]);
  });

  it("accepts other thematic-break spellings", () => {
    const src = "---\nmarp: true\n---\n\na\n\n***\n\nb\n\n___\n\nc\n";
    expect(slideStartLines(src)).toEqual([3, 7, 11]);
  });

  it("handles a deck with no body after the front-matter", () => {
    const src = "---\nmarp: true\n---\n";
    expect(slideStartLines(src)).toHaveLength(1);
  });

  it("returns a single slide for content without front-matter", () => {
    const src = "# Hi\n\n---\n\n## Two\n";
    expect(slideStartLines(src)).toEqual([0, 3]);
  });

  /*
   * Two spellings Marp renders as a single slide, which the old line-by-line
   * scan counted as two. Every slide after one of them was mapped to the wrong
   * source line, so clicking a slide jumped to the wrong place in the editor,
   * and the presenter — which reads its per-slide transitions off the same
   * split — animated each slide with its neighbour's.
   */

  it("does not break on a --- that underlines a setext heading", () => {
    // CommonMark gives the heading precedence over the thematic break here,
    // so Marp renders one slide.
    const src = "---\nmarp: true\n---\n\nSome text\n---\nmore\n";
    expect(slideStartLines(src)).toEqual([3]);
  });

  it("does not break on a --- indented inside a list", () => {
    // It belongs to the list item. Leading whitespace on its own cannot tell
    // this apart from a real break, which is how the scan got it wrong.
    const src = "---\nmarp: true\n---\n\n- item\n\n  ---\n\n- other\n";
    expect(slideStartLines(src)).toEqual([3]);
  });

  it("does not break on a --- inside a blockquote", () => {
    const src = "---\nmarp: true\n---\n\nSome text\n\n> ---\n\nmore\n";
    expect(slideStartLines(src)).toEqual([3]);
  });

  /*
   * The other half, and the half worth having: three lines that look like the
   * two above and *are* slide breaks. A rule as tempting as "a --- under a
   * non-blank line underlines a heading" fixes the cases above and silently
   * breaks all three of these, so they are pinned against the fix as much as
   * against the bug.
   */

  it("still breaks on a --- under an ATX heading", () => {
    // `# Heading` is not a paragraph, so there is nothing to underline.
    const src = "---\nmarp: true\n---\n\n# Heading\n---\nmore\n";
    expect(slideStartLines(src)).toEqual([3, 6]);
  });

  it("still breaks on a --- under a list item", () => {
    const src = "---\nmarp: true\n---\n\n- item\n---\nmore\n";
    expect(slideStartLines(src)).toEqual([3, 6]);
  });

  it("still breaks on a spaced-out - - - under a paragraph", () => {
    // A setext underline admits no internal spaces, so this can only be a
    // thematic break.
    const src = "---\nmarp: true\n---\n\nSome text\n- - -\nmore\n";
    expect(slideStartLines(src)).toEqual([3, 6]);
  });
});
