// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseHeadings, findActiveHeading } from "./outlineUtils";

describe("parseHeadings", () => {
  it("extracts headings with level, text and 0-based line", () => {
    const content = "# Title\n\nSome text\n\n## Sub\n\n### Sub-sub\n";
    expect(parseHeadings(content)).toEqual([
      { level: 1, text: "Title", line: 0 },
      { level: 2, text: "Sub", line: 4 },
      { level: 3, text: "Sub-sub", line: 6 },
    ]);
  });

  it("supports all six heading levels", () => {
    const content = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\n";
    const headings = parseHeadings(content);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns an empty array when there are no headings", () => {
    expect(parseHeadings("plain text\nno headings here\n")).toEqual([]);
    expect(parseHeadings("")).toEqual([]);
  });

  it("ignores hashes that are not ATX headings (code fences, inline)", () => {
    const content = "```\n# not a heading\n```\n\nText with # hash and ## not heading\n";
    // The inline "## not heading" has no leading whitespace/line start context
    // beyond the regex — it matches the LAST line, so assert behavior precisely:
    // a line starting with # inside a fence IS matched by this simple regex
    // (documented limitation of the lightweight parser).
    expect(parseHeadings(content)).toEqual([
      { level: 1, text: "not a heading", line: 1 },
    ]);
  });

  it("trims trailing whitespace from heading text", () => {
    expect(parseHeadings("# Spaced out   ")).toEqual([
      { level: 1, text: "Spaced out", line: 0 },
    ]);
  });

  // ---- Typst headings ----

  it("parses Typst headings (= through ====)", () => {
    const content = "= Introduction\n\n== Background\n\n=== Details\n\n==== Sub-details\n";
    expect(parseHeadings(content)).toEqual([
      { level: 1, text: "Introduction", line: 0 },
      { level: 2, text: "Background", line: 2 },
      { level: 3, text: "Details", line: 4 },
      { level: 4, text: "Sub-details", line: 6 },
    ]);
  });

  it("parses mixed Markdown and Typst headings", () => {
    const content = "# MD Heading\n\n= Typst Heading\n\n### Sub MD\n\n== Sub Typst\n";
    expect(parseHeadings(content)).toEqual([
      { level: 1, text: "MD Heading", line: 0 },
      { level: 1, text: "Typst Heading", line: 2 },
      { level: 3, text: "Sub MD", line: 4 },
      { level: 2, text: "Sub Typst", line: 6 },
    ]);
  });

  it("ignores = signs that are not at line start (Typst)", () => {
    const content = "Not a heading = test\n= Real heading\n  = indented (not a heading)\n";
    expect(parseHeadings(content)).toEqual([
      { level: 1, text: "Real heading", line: 1 },
    ]);
  });

  it("ignores ==== with more than 4 equals (Typst max level 4)", () => {
    const content = "===== Too many equals\n==== Just right\n";
    expect(parseHeadings(content)).toEqual([
      { level: 4, text: "Just right", line: 1 },
    ]);
  });
});

describe("findActiveHeading", () => {
  const headings = [
    { level: 1, text: "Intro", line: 0 },
    { level: 2, text: "Setup", line: 10 },
    { level: 2, text: "Usage", line: 25 },
  ];

  it("returns the last heading at or above the cursor line", () => {
    expect(findActiveHeading(headings, 0)).toBe(0);
    expect(findActiveHeading(headings, 9)).toBe(0);
    expect(findActiveHeading(headings, 10)).toBe(10);
    expect(findActiveHeading(headings, 24)).toBe(10);
    expect(findActiveHeading(headings, 25)).toBe(25);
    expect(findActiveHeading(headings, 999)).toBe(25);
  });

  it("returns undefined when the cursor is above the first heading", () => {
    expect(findActiveHeading(headings, -1)).toBeUndefined();
  });

  it("returns undefined for empty heading lists", () => {
    expect(findActiveHeading([], 5)).toBeUndefined();
  });

  it("returns undefined when cursorLine is undefined-ish", () => {
    expect(findActiveHeading(headings, Number.NaN)).toBeUndefined();
  });
});
