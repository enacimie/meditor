import { describe, it, expect } from "vitest";
import { frontMatterLines, frontMatterValue, frontMatterFlag } from "./frontMatter";

/**
 * The YAML block at the top, and the shapes it is allowed to take.
 *
 * These cases were covered only indirectly before, through the three modules
 * that read the block — Marp detection, the presentation directives, and the
 * markdown rule that keeps it out of the output. That was enough while the
 * reader was four lines of `split` and `slice`; it is not enough now that it
 * walks the text itself, because the ways it can go wrong are its own.
 */
describe("finding the block", () => {
  it("reads the lines between the fences", () => {
    expect(frontMatterLines("---\ntitle: One\nmarp: true\n---\n\n# Hi\n")).toEqual([
      "title: One",
      "marp: true",
    ]);
  });

  it("accepts the other closing fence", () => {
    // `...` ends a YAML document, and Marp files in the wild use it.
    expect(frontMatterLines("---\ntitle: One\n...\n# Hi\n")).toEqual(["title: One"]);
  });

  it("is nothing at all when the document does not open with a fence", () => {
    expect(frontMatterLines("# Hi\n\n---\n\nslide two\n")).toBeNull();
    expect(frontMatterLines("")).toBeNull();
    expect(frontMatterLines("plain text")).toBeNull();
  });

  it("is nothing when the fence is never closed", () => {
    // A leading `---` with no partner is a horizontal rule, and reading the
    // rest of the document as configuration would be a poor way to find out.
    expect(frontMatterLines("---\ntitle: One\n# and no more")).toBeNull();
  });

  it("survives CRLF, and hands back lines with no carriage return in them", () => {
    const lines = frontMatterLines("---\r\ntitle: One\r\nmarp: true\r\n---\r\n# Hi\r\n");
    expect(lines).toEqual(["title: One", "marp: true"]);
  });

  it("survives a byte-order mark, which otherwise hides the opening fence", () => {
    expect(frontMatterLines("﻿---\ntitle: One\n---\n")).toEqual(["title: One"]);
  });

  it("handles a document that ends inside the block, with no final newline", () => {
    expect(frontMatterLines("---\ntitle: One")).toBeNull();
    expect(frontMatterLines("---\ntitle: One\n---")).toEqual(["title: One"]);
  });

  it("keeps an empty line inside the block", () => {
    expect(frontMatterLines("---\ntitle: One\n\nmarp: true\n---\n")).toEqual([
      "title: One",
      "",
      "marp: true",
    ]);
  });
});

describe("reading a value out of it", () => {
  it("takes a top-level scalar", () => {
    expect(frontMatterValue("---\ntitle: One\n---\n", "title")).toBe("One");
  });

  it("ignores case in the key and space around the value", () => {
    expect(frontMatterValue("---\nTitle:   One  \n---\n", "title")).toBe("One");
  });

  it("drops a trailing comment and the quotes", () => {
    expect(frontMatterValue('---\ntitle: "One" # the first\n---\n', "title")).toBe("One");
  });

  it("refuses a key that is indented, because it may belong to a block scalar", () => {
    /*
     * The reason keys must start at column zero: a `style: |` payload can
     * contain anything, including a line that reads like a directive, and
     * mistaking one for configuration would opt a document into a mode it
     * never asked for.
     */
    const deck = "---\nstyle: |\n  title: not really\n---\n";
    expect(frontMatterValue(deck, "title")).toBeNull();
  });

  it("requires the space YAML requires", () => {
    // `marp:true` is a scalar string, not a mapping.
    expect(frontMatterFlag("---\nmarp:true\n---\n", "marp")).toBe(false);
    expect(frontMatterFlag("---\nmarp: true\n---\n", "marp")).toBe(true);
  });

  it("reads a flag whatever case it is written in", () => {
    expect(frontMatterFlag("---\nmarp: TRUE\n---\n", "marp")).toBe(true);
    expect(frontMatterFlag("---\nmarp: yes\n---\n", "marp")).toBe(false);
  });
});
