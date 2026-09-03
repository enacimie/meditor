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
});
