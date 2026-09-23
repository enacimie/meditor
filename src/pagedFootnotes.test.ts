// @vitest-environment jsdom
/**
 * Lifting notes next to their calls, for the Document view.
 *
 * Checked on what the real renderer produces, since the transform depends on
 * markdown-it-footnote's exact markup. Where each note finally lands is
 * paged.js's doing and is measured in tests/e2e/footnotes.spec.mjs.
 */
import { describe, it, expect } from "vitest";
import { footnotesToCalls, MAX_LIFTED_NOTE_CHARS } from "./pagedFootnotes";
import { renderMarkdown } from "./markdown";

function lifted(source: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(source);
  footnotesToCalls(root);
  return root;
}

const notesLeft = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("li.footnote-item")).map((li) => ({
    id: li.id,
    value: li.getAttribute("value"),
  }));

describe("footnotesToCalls", () => {
  it("lifts a note next to its call, with markdown-it's number and id", () => {
    const root = lifted("Text.[^a]\n\n[^a]: Note a.");
    const paragraph = root.querySelector("p")!;
    const call = paragraph.querySelector("sup.footnote-call")!;
    expect(call.textContent).toBe("1");
    const note = call.nextElementSibling!;
    expect(note.matches("span.footnote")).toBe(true);
    expect(note.querySelector(".footnote-number")!.id).toBe("fn1");
    expect(note.textContent).toBe("1 Note a.");
    // The call still links to the note.
    expect(call.querySelector("a")!.getAttribute("href")).toBe("#fn1");
    // Nothing is left at the end.
    expect(root.querySelector("section.footnotes")).toBeNull();
    expect(root.querySelector("hr.footnotes-sep")).toBeNull();
  });

  it("prints a note cited twice once, and calls it by its number both times", () => {
    const root = lifted("One.[^a] Two.[^a]\n\n[^a]: Note a.");
    expect(root.querySelectorAll("span.footnote")).toHaveLength(1);
    const calls = Array.from(root.querySelectorAll("sup.footnote-call")).map((c) => c.textContent);
    expect(calls).toEqual(["1", "1"]);
  });

  it("drops the back-links a note at the foot of its page has no use for", () => {
    const root = lifted("Text.[^a]\n\n[^a]: Note a.");
    const note = root.querySelector("span.footnote")!;
    expect(note.querySelector(".footnote-backref")).toBeNull();
    expect(note.textContent?.endsWith("Note a.")).toBe(true);
  });

  it("keeps the line the note is defined on, so Go to preview still finds it", () => {
    const root = lifted("Text.[^a]\n\nMore.\n\n[^a]: Note a.");
    expect(root.querySelector("span.footnote")!.getAttribute("data-line")).toBe("4");
  });

  it("lifts an inline note too", () => {
    const root = lifted("Text.^[An inline note.]");
    expect(root.querySelector("span.footnote")!.textContent).toBe("1 An inline note.");
  });

  it("leaves a note with a list in it at the end, keeping its number", () => {
    const root = lifted("One.[^a] Two.[^b]\n\n[^a]: Note a.\n[^b]: Note b:\n\n    - first\n    - second");
    expect(root.querySelectorAll("span.footnote")).toHaveLength(1);
    expect(notesLeft(root)).toEqual([{ id: "fn2", value: "2" }]);
    // Its call is left as it was.
    const calls = Array.from(root.querySelectorAll("sup.footnote-ref"));
    expect(calls.map((c) => c.textContent)).toEqual(["1", "[2]"]);
  });

  it("leaves a note called from another note at the end", () => {
    const root = lifted("Text.[^a]\n\n[^a]: Note a, which calls another.[^b]\n[^b]: Note b.");
    expect(root.querySelector("span.footnote")!.textContent).toContain("Note a, which calls another.");
    expect(notesLeft(root)).toEqual([{ id: "fn2", value: "2" }]);
  });

  it("leaves a note called from a heading at the end", () => {
    const root = lifted("# Title[^a]\n\n[^a]: Note a.");
    expect(root.querySelector("span.footnote")).toBeNull();
    expect(notesLeft(root)).toEqual([{ id: "fn1", value: "1" }]);
  });

  it("leaves a note too long for one page at the end", () => {
    const long = "word ".repeat(Math.ceil(MAX_LIFTED_NOTE_CHARS / 5) + 10).trim();
    const root = lifted(`Short.[^a] Long.[^b]\n\n[^a]: Note a.\n[^b]: ${long}`);
    expect(root.querySelectorAll("span.footnote")).toHaveLength(1);
    expect(notesLeft(root)).toEqual([{ id: "fn2", value: "2" }]);
  });

  it("leaves a document without notes alone", () => {
    const source = "# Title\n\nJust text.";
    const root = lifted(source);
    const plain = document.createElement("div");
    plain.innerHTML = renderMarkdown(source);
    expect(root.innerHTML).toBe(plain.innerHTML);
  });
});
