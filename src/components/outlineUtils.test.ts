// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseHeadings, findActiveHeading } from "./outlineUtils";

describe("parseHeadings", () => {
  it("extracts headings with level, text and 0-based line", () => {
    const content = "# Title\n\nSome text\n\n## Sub\n\n### Sub-sub\n";
    expect(parseHeadings(content, "markdown")).toEqual([
      { level: 1, text: "Title", line: 0 },
      { level: 2, text: "Sub", line: 4 },
      { level: 3, text: "Sub-sub", line: 6 },
    ]);
  });

  it("supports all six heading levels", () => {
    const content = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\n";
    const headings = parseHeadings(content, "markdown");
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns an empty array when there are no headings", () => {
    expect(parseHeadings("plain text\nno headings here\n", "markdown")).toEqual([]);
    expect(parseHeadings("", "markdown")).toEqual([]);
    expect(parseHeadings("", "typst")).toEqual([]);
  });

  it("leaves out a hash inside a code fence, and one in the middle of a line", () => {
    const content = "```\n# not a heading\n```\n\nText with # hash and ## not heading\n";
    expect(parseHeadings(content, "markdown")).toEqual([]);
  });

  it("does not let a lone # or = make the next line a heading", () => {
    expect(parseHeadings("#\nNot a heading\n", "markdown")).toEqual([]);
    expect(parseHeadings("=\nNot a heading\n", "typst")).toEqual([]);
  });

  it("trims trailing whitespace from heading text", () => {
    expect(parseHeadings("# Spaced out   ", "markdown")).toEqual([
      { level: 1, text: "Spaced out", line: 0 },
    ]);
  });

  // ---- Code blocks and front-matter ----

  it("leaves out every line of a fenced block, backticks or tildes, and keeps counting lines", () => {
    const content = [
      "# Install", //           0
      "```bash", //             1
      "# the package manager", // 2
      "pnpm install", //        3
      "```", //                 4
      "## Run", //              5
      "~~~python", //           6
      "# a comment", //         7
      "~~~", //                 8
      "## Done", //             9
    ].join("\n");
    expect(parseHeadings(content, "markdown")).toEqual([
      { level: 1, text: "Install", line: 0 },
      { level: 2, text: "Run", line: 5 },
      { level: 2, text: "Done", line: 9 },
    ]);
  });

  // In each of these, a fence closed too early lists "inside", and the fence
  // line that should have closed it opens another, which swallows "after".
  it("closes a fence only with its own character", () => {
    expect(parseHeadings("```\n~~~\n# inside\n```\n# after\n", "markdown")).toEqual([
      { level: 1, text: "after", line: 4 },
    ]);
  });

  it("closes a fence only with at least as many of them", () => {
    expect(parseHeadings("````\n```\n# inside\n`````\n# after\n", "markdown")).toEqual([
      { level: 1, text: "after", line: 4 },
    ]);
  });

  it("closes a fence only with a line that has nothing else on it", () => {
    expect(parseHeadings("```\n``` not a close\n# inside\n```\n# after\n", "markdown")).toEqual([
      { level: 1, text: "after", line: 4 },
    ]);
  });

  it("runs a fence that is never closed to the end, as CommonMark does", () => {
    expect(parseHeadings("# Before\n```\n# after an open fence\n", "markdown")).toEqual([
      { level: 1, text: "Before", line: 0 },
    ]);
  });

  it("does not take a run of backticks with a backtick after it for a fence", () => {
    // Three backticks and an info string holding one: inline code, not a fence.
    expect(parseHeadings("``` a`b\n# Heading\n", "markdown")).toEqual([
      { level: 1, text: "Heading", line: 1 },
    ]);
  });

  it("leaves out the front-matter, whose `#` lines are YAML comments", () => {
    const content = "---\n# set by the template\ntitle: Notes\n---\n# Notes\n";
    expect(parseHeadings(content, "markdown")).toEqual([{ level: 1, text: "Notes", line: 4 }]);
  });

  it("does not take a leading rule that is never closed for front-matter", () => {
    expect(parseHeadings("---\n# Heading\n", "markdown")).toEqual([
      { level: 1, text: "Heading", line: 1 },
    ]);
  });

  // ---- Typst headings ----

  it("parses Typst headings (= through ====)", () => {
    const content = "= Introduction\n\n== Background\n\n=== Details\n\n==== Sub-details\n";
    expect(parseHeadings(content, "typst")).toEqual([
      { level: 1, text: "Introduction", line: 0 },
      { level: 2, text: "Background", line: 2 },
      { level: 3, text: "Details", line: 4 },
      { level: 4, text: "Sub-details", line: 6 },
    ]);
  });

  it("reads only the heading syntax of the document's own language", () => {
    const content = "# MD Heading\n\n= Typst Heading\n\n### Sub MD\n\n== Sub Typst\n";
    expect(parseHeadings(content, "markdown")).toEqual([
      { level: 1, text: "MD Heading", line: 0 },
      { level: 3, text: "Sub MD", line: 4 },
    ]);
    expect(parseHeadings(content, "typst")).toEqual([
      { level: 1, text: "Typst Heading", line: 2 },
      { level: 2, text: "Sub Typst", line: 6 },
    ]);
  });

  it("leaves out a Typst raw block, and takes no tildes for one", () => {
    const content = "= Code\n```typ\n= inside the raw block\n```\n~~~\n== After\n";
    expect(parseHeadings(content, "typst")).toEqual([
      { level: 1, text: "Code", line: 0 },
      { level: 2, text: "After", line: 5 },
    ]);
  });

  it("does not read front-matter in Typst, which has none", () => {
    expect(parseHeadings("---\n= Heading\n---\n", "typst")).toEqual([
      { level: 1, text: "Heading", line: 1 },
    ]);
  });

  it("ignores = signs that are not at line start (Typst)", () => {
    const content = "Not a heading = test\n= Real heading\n  = indented (not a heading)\n";
    expect(parseHeadings(content, "typst")).toEqual([
      { level: 1, text: "Real heading", line: 1 },
    ]);
  });

  it("ignores ==== with more than 4 equals (Typst max level 4)", () => {
    const content = "===== Too many equals\n==== Just right\n";
    expect(parseHeadings(content, "typst")).toEqual([
      { level: 4, text: "Just right", line: 1 },
    ]);
  });

  it("reads no headings in LaTeX, whose sectioning commands it does not know", () => {
    expect(parseHeadings("\\section{Intro}\n# not LaTeX\n= nor this\n", "latex")).toEqual([]);
  });

  // ---- Line numbering ----

  /** A full re-split of the document at every match, as the parser once did. */
  function parseHeadingsNaive(content: string) {
    const re = /^(#{1,6})[ \t]+(.+)$/gm;
    const out: { level: number; text: string; line: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      out.push({
        level: match[1].length,
        text: match[2].trim(),
        line: content.slice(0, match.index).split("\n").length - 1,
      });
    }
    return out;
  }

  it("numbers lines exactly like a full re-split of the document", () => {
    const cases = [
      "# First line heading\ntext\n## Second\n",
      "no heading at all\n",
      "\n\n\n# After blank lines",
      "# Adjacent\n# Headings\n# In a row\n",
      "text\n# No trailing newline",
      "# Only heading",
      "\n# Leading newline\n\n\n## Gaps\n\n\n\n### More gaps\n",
      "# Unicode ✨ heading\n\n## Ünïcödé\n",
    ];
    for (const content of cases) {
      expect(parseHeadings(content, "markdown"), JSON.stringify(content)).toEqual(
        parseHeadingsNaive(content),
      );
    }
  });

  it("numbers lines correctly in a large document", () => {
    // Exercises the line counter across many headings, where a parser that
    // re-counted from the top at every match was quadratic.
    const lines: string[] = [];
    const expected: { level: number; text: string; line: number }[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`# Heading ${i}`, "", "filler paragraph", "");
      expected.push({ level: 1, text: `Heading ${i}`, line: i * 4 });
    }
    const content = lines.join("\n");
    expect(parseHeadings(content, "markdown")).toEqual(expected);
    expect(parseHeadings(content, "markdown")).toEqual(parseHeadingsNaive(content));
  });

  it("handles CRLF documents", () => {
    // The \r belongs to the line break: the line index is not thrown off by
    // it, and a fence followed by one still closes.
    const headings = parseHeadings("# One\r\n\r\n```\r\n# code\r\n```\r\n## Two\r\n", "markdown");
    expect(headings).toEqual([
      { level: 1, text: "One", line: 0 },
      { level: 2, text: "Two", line: 5 },
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
