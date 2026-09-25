// @vitest-environment jsdom
/**
 * Which preview block a source line scrolls to.
 *
 * "Go to preview" and the editor-to-preview sync scroll to the block that
 * owns the caret's line. Blocks are not in line order — endnotes are drawn at
 * the end with the line of their definition — and the old walk assumed they
 * were.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { blockForLine, blocksForLines, markLines } from "./previewSync";
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

describe("blocksForLines", () => {
  /** The blocks a real render draws, and a way to name what was picked. */
  function rendered(source: string) {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(source);
    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-line]"));
    const pick = (from: number, to: number) =>
      blocksForLines(nodes, from, to).map((n) => `${n.tagName.toLowerCase()}@${n.getAttribute("data-line")}`);
    return { nodes, pick };
  }

  const DOCUMENT = [
    "# Title", //                 0
    "", //                        1
    "A paragraph that runs", //   2
    "over two lines.", //         3
    "", //                        4
    "- one", //                   5
    "- two", //                   6
    "", //                        7
    "> quoted", //                8
    ">", //                       9
    "> still quoted", //          10
    "", //                        11
    "| a | b |", //               12
    "| - | - |", //               13
    "| 1 | 2 |", //               14
    "", //                        15
    "Last.", //                   16
  ].join("\n");

  it("is the block a line is in, from any of its lines", () => {
    const { nodes, pick } = rendered(DOCUMENT);
    // The premise: the map these picks read.
    expect(nodes.map((n) => `${n.tagName.toLowerCase()}@${n.getAttribute("data-line")}`)).toEqual([
      "h1@0", "p@2", "ul@5", "li@5", "li@6", "blockquote@8", "p@8", "p@10",
      "table@12", "thead@12", "tr@12", "tbody@14", "tr@14", "p@16",
    ]);
    expect(pick(3, 3)).toEqual(["p@2"]);
  });

  it("is what a click in the preview marks: the item, the row, the paragraph", () => {
    const { pick } = rendered(DOCUMENT);
    expect(pick(5, 6)).toEqual(["li@5", "li@6"]);
    expect(pick(6, 6)).toEqual(["li@6"]);
    expect(pick(8, 10)).toEqual(["p@8", "p@10"]);
    expect(pick(12, 14)).toEqual(["tr@12", "tr@14"]);
  });

  it("is every block from the first line to the last, whatever kind", () => {
    const { pick } = rendered(DOCUMENT);
    expect(pick(2, 6)).toEqual(["p@2", "li@5", "li@6"]);
    expect(pick(16, 40)).toEqual(["p@16"]);
  });

  it("is nothing for a selection in front matter that is not drawn", () => {
    const { pick } = rendered(["---", "lang: es", "---", "", "Text."].join("\n"));
    expect(pick(0, 2)).toEqual([]);
    expect(pick(0, 4)).toEqual(["p@4"]);
  });

  it("is both halves of a paragraph paged.js split across two pages", () => {
    const nodes = blocks(0, 2, 2, 4);
    expect(blocksForLines(nodes, 2, 2).map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(blocksForLines([], 0, 3)).toEqual([]);
  });
});

describe("markLines", () => {
  const SOURCE = ["First.", "", "- one", "- two", "", "Last."].join("\n");

  /** A preview as the app lays it out: a scroller holding the two views. */
  function preview() {
    const scroller = document.createElement("div");
    scroller.className = "preview-scroll";
    const web = document.createElement("div");
    const paged = document.createElement("div");
    web.innerHTML = renderMarkdown(SOURCE);
    paged.innerHTML = renderMarkdown(SOURCE);
    scroller.append(web, paged);
    document.body.append(scroller);
    const marked = (root: HTMLElement) =>
      [...root.querySelectorAll(".sync-selected")].map((el) => `${el.tagName.toLowerCase()}@${el.getAttribute("data-line")}`);
    return { scroller, web, paged, marked };
  }

  /** Where the scroller's window is and where each block sits, as layout would say. */
  function place(el: Element, top: number, bottom: number) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top, bottom } as DOMRect);
  }

  const scrolled: Element[] = [];
  const scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };

  afterEach(() => {
    document.body.innerHTML = "";
    scrolled.length = 0;
    vi.restoreAllMocks();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("marks what the lines cover, after taking the mark off everything else", () => {
    const { web, paged, marked } = preview();
    paged.querySelector("p")!.classList.add("sync-selected");
    markLines({ clearFrom: [web, paged], container: web, lines: { from: 2, to: 3 }, className: "sync-selected", scroll: false });
    expect(marked(web)).toEqual(["li@2", "li@3"]);
    expect(marked(paged)).toEqual([]);
  });

  it("only clears, for no lines", () => {
    const { web, paged, marked } = preview();
    markLines({ clearFrom: [web, paged], container: web, lines: { from: 0, to: 0 }, className: "sync-selected", scroll: false });
    markLines({ clearFrom: [web, paged], container: web, lines: null, className: "sync-selected", scroll: false });
    expect(marked(web)).toEqual([]);
  });

  it("brings the first block into view only when none of them is in it", () => {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true });
    const { scroller, web, paged } = preview();
    place(scroller, 100, 400);
    const [one, two] = [...web.querySelectorAll("li")];
    const mark = (scroll: boolean) =>
      markLines({ clearFrom: [web, paged], container: web, lines: { from: 2, to: 3 }, className: "sync-selected", scroll });

    // Both below the window: the first is brought up.
    place(one, 500, 520);
    place(two, 520, 540);
    mark(true);
    expect(scrolled).toEqual([one]);

    // The second already showing: nothing moves.
    place(two, 380, 420);
    mark(true);
    expect(scrolled).toEqual([one]);

    // Asked not to: nothing moves either, wherever they are.
    place(two, 520, 540);
    mark(false);
    expect(scrolled).toEqual([one]);
  });
});
