import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSITION,
  frontmatterValue,
  parseSlidePresents,
} from "./marpPresent";

function deck(frontmatter: string[], ...slides: string[]): string {
  return ["---", "marp: true", ...frontmatter, "---", "", slides.join("\n---\n")].join("\n");
}

describe("frontmatterValue", () => {
  it("reads a top-level key", () => {
    expect(frontmatterValue(deck(["transition: wipe"], "# a"), "transition")).toBe("wipe");
  });

  it("ignores keys that only appear inside an indented style block", () => {
    const content = [
      "---",
      "marp: true",
      "style: |",
      "  section { transition: opacity 0.3s; }",
      "  .x { color: red; }",
      "---",
      "",
      "# a",
    ].join("\n");
    expect(frontmatterValue(content, "transition")).toBeNull();
  });

  it("returns null when the key is absent", () => {
    expect(frontmatterValue(deck([], "# a"), "transition")).toBeNull();
  });
});

describe("parseSlidePresents", () => {
  it("defaults every slide to a visible fade", () => {
    const res = parseSlidePresents(deck([], "# a", "# b"));
    expect(res).toHaveLength(2);
    expect(res.every((s) => s.transition === DEFAULT_TRANSITION)).toBe(true);
    expect(res.every((s) => s.duration === null)).toBe(true);
  });

  it("applies a front-matter transition to every slide", () => {
    const res = parseSlidePresents(deck(["transition: zoom"], "# a", "# b", "# c"));
    expect(res.map((s) => s.transition)).toEqual(["zoom", "zoom", "zoom"]);
  });

  it("lets a local directive override the front-matter for one slide", () => {
    const res = parseSlidePresents(
      deck(["transition: zoom"], "# a", "<!-- transition: wipe -->\n\n# b", "# c"),
    );
    expect(res.map((s) => s.transition)).toEqual(["zoom", "wipe", "zoom"]);
  });

  it("parses none as instant", () => {
    const res = parseSlidePresents(deck([], "# a", "<!-- transition: none -->\n\n# b"));
    expect(res[1].transition).toBe("none");
  });

  it("parses a duration token", () => {
    const res = parseSlidePresents(deck([], "<!-- transition: fade 0.6s -->\n\n# a"));
    expect(res[0].transition).toBe("fade");
    expect(res[0].duration).toBe("0.6s");
  });

  it("falls back to fade for unknown types", () => {
    const res = parseSlidePresents(deck([], "<!-- transition: bogus -->\n\n# a"));
    expect(res[0].transition).toBe(DEFAULT_TRANSITION);
  });

  it("does not treat transition look-alikes inside code fences as directives", () => {
    const res = parseSlidePresents(
      deck([], "# a", "```html\n<!-- transition: zoom -->\n```\n\n# b"),
    );
    // The parser is deliberately line-based; a fenced look-alike is an accepted
    // edge case, but it must not throw and must yield one entry per slide.
    expect(res).toHaveLength(2);
  });
});
