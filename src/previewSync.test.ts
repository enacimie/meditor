// @vitest-environment jsdom
/**
 * Which preview block a source line scrolls to.
 *
 * "Go to preview" and the editor-to-preview sync scroll to the block that
 * owns the caret's line. Blocks are not in line order — endnotes are drawn at
 * the end with the line of their definition — and the old walk assumed they
 * were.
 */
import { describe, it, expect } from "vitest";
import { blockForLine } from "./previewSync";
import { renderMarkdown } from "./markdown";

/** Blocks as the preview holds them, in document order. */
function blocks(...lines: number[]): HTMLElement[] {
  return lines.map((line, index) => {
    const el = document.createElement("p");
    el.setAttribute("data-line", String(line));
    el.id = `b${index}`;
    return el;
  });
}

describe("blockForLine", () => {
  it("reaches a block drawn later than the lines after it", () => {
    // An endnote defined on line 6, drawn after the paragraph on line 8.
    const nodes = blocks(0, 2, 4, 8, 6);
    expect(blockForLine(nodes, 6)?.id).toBe("b4");
  });

  it("does not run on into a block drawn late for an earlier line", () => {
    const nodes = blocks(0, 2, 4, 8, 6);
    expect(blockForLine(nodes, 8)?.id).toBe("b3");
    expect(blockForLine(nodes, 9)?.id).toBe("b3");
  });

  it("takes the last of blocks on the same line", () => {
    // Nested blocks, or a paragraph paged.js split across two pages.
    const nodes = blocks(0, 4, 4, 6);
    expect(blockForLine(nodes, 5)?.id).toBe("b2");
  });

  it("takes the first block for a line before all of them, and none from nothing", () => {
    expect(blockForLine(blocks(3, 5), 1)?.id).toBe("b0");
    expect(blockForLine([], 1)).toBeNull();
  });

  it("finds the endnote and the last paragraph in a real render", () => {
    const source = [
      "# Title",
      "",
      "First paragraph with a note.[^a]",
      "",
      "Second paragraph.",
      "",
      "[^a]: The note itself.",
      "",
      "Last paragraph.",
    ].join("\n");
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(source);
    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-line]"));
    // The premise: the note really is drawn after the paragraph below it.
    expect(nodes.map((n) => n.getAttribute("data-line"))).toEqual(["0", "2", "4", "8", "6"]);

    expect(blockForLine(nodes, 6)?.textContent).toContain("The note itself.");
    expect(blockForLine(nodes, 8)?.textContent).toBe("Last paragraph.");
  });
});
