// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { splitLongFencedBlocks, keepHeadingsWithContent } from "./previewRenderer";

/* ---- splitLongFencedBlocks ---- */
describe("splitLongFencedBlocks", () => {
  it("returns unchanged markdown when no fenced blocks exist", () => {
    const input = "# Hello\n\nSome paragraph text.";
    expect(splitLongFencedBlocks(input)).toBe(input);
  });

  it("returns unchanged markdown for short fenced blocks", () => {
    const input = [
      "```js",
      "const x = 1;",
      "const y = 2;",
      "```",
    ].join("\n");
    expect(splitLongFencedBlocks(input)).toBe(input);
  });

  it("splits a long fenced block into multiple chunks", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`line${i}`);
    }
    const input = ["```js", ...lines, "```"].join("\n");
    const result = splitLongFencedBlocks(input, 45);

    // Should have 3 chunks: 45 + 45 + 10 lines
    const chunks = result.split("\n\n");
    expect(chunks.length).toBe(3);
    // First chunk: 45 lines of code
    expect(chunks[0]).toContain("```js");
    expect(chunks[0]).toContain("line0");
    expect(chunks[0]).toContain("line44");
    // Second chunk: next 45 lines
    expect(chunks[1]).toContain("```js");
    expect(chunks[1]).toContain("line45");
    expect(chunks[1]).toContain("line89");
    // Third chunk: remaining 10
    expect(chunks[2]).toContain("```js");
    expect(chunks[2]).toContain("line90");
    expect(chunks[2]).toContain("line99");
  });

  it("preserves the language identifier on all chunks", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push("// comment");
    const input = ["```typescript", ...lines, "```"].join("\n");
    const result = splitLongFencedBlocks(input, 45);

    const chunks = result.split("\n\n");
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("```typescript");
    expect(chunks[1]).toContain("```typescript");
  });

  it("uses custom maxLines parameter", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push("x");
    const input = ["```", ...lines, "```"].join("\n");

    // maxLines=10 → 2 chunks
    const result10 = splitLongFencedBlocks(input, 10);
    expect(result10.split("\n\n").length).toBe(2);

    // maxLines=40 → 1 chunk (unchanged)
    const result40 = splitLongFencedBlocks(input, 40);
    expect(result40).toBe(input);
  });

  it("handles multiple fenced blocks in one document", () => {
    const longLines: string[] = [];
    for (let i = 0; i < 50; i++) longLines.push(`line${i}`);

    const input = [
      "# Doc",
      "",
      "```python",
      ...longLines,
      "```",
      "",
      "Some text",
      "",
      "```bash",
      "echo short",
      "```",
    ].join("\n");

    const result = splitLongFencedBlocks(input, 30);
    // The python block should be split (50 lines → 2 chunks at 30 limit)
    // The bash block should stay intact
    const chunks = result.split("\n\n");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(result).toContain("echo short");
    expect(result).toContain("```bash");
  });

  it("handles trailing blank line inside fenced block", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push("x");

    const input = ["```", ...lines, "```"].join("\n");
    const result = splitLongFencedBlocks(input, 30);
    const chunks = result.split("\n\n");
    // 60 lines ÷ 30 = exactly 2 chunks
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("```");
    expect(chunks[1]).toContain("```");
  });

  it("handles indented fences (3+ backticks)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push("a");
    const input = ["````md", ...lines, "````"].join("\n");
    const result = splitLongFencedBlocks(input, 30);
    expect(result.split("\n\n").length).toBe(2);
  });

  it("does not split non-fenced backtick sequences", () => {
    const input = "Inline `code` with `backticks` and ```not a block";
    expect(splitLongFencedBlocks(input, 5)).toBe(input);
  });
});

/* ---- keepHeadingsWithContent ---- */
describe("keepHeadingsWithContent", () => {
  /** Build a block container, giving every child a data-line like the renderer does. */
  function build(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    [...root.children].forEach((el, i) => el.setAttribute("data-line", String(i + 1)));
    return root;
  }

  /** jsdom lays nothing out, so heights come from here instead of offsetHeight. */
  const fixed = (px: number) => () => px;

  const lines = (root: HTMLElement) =>
    [...root.querySelectorAll("[data-line]")].map((el) => el.getAttribute("data-line"));

  it("keeps a heading with the block that follows it", () => {
    const root = build("<h2>Title</h2><p>Body</p><p>More</p>");
    keepHeadingsWithContent(root, fixed(20));

    const wrapper = root.querySelector(".keep-with-next");
    expect(wrapper).toBeTruthy();
    expect([...wrapper!.children].map((el) => el.tagName)).toEqual(["H2", "P"]);
    // The paragraph left outside stays a sibling of the wrapper.
    expect(root.children.length).toBe(2);
  });

  it("groups a run of consecutive headings with the first real block", () => {
    const root = build("<h2>Section</h2><h3>Subsection</h3><pre>code</pre><p>After</p>");
    keepHeadingsWithContent(root, fixed(20));

    const wrappers = root.querySelectorAll(".keep-with-next");
    expect(wrappers).toHaveLength(1);
    expect([...wrappers[0].children].map((el) => el.tagName)).toEqual(["H2", "H3", "PRE"]);
  });

  it("leaves a trailing heading alone, having nothing to keep it with", () => {
    const root = build("<p>Body</p><h2>The end</h2>");
    keepHeadingsWithContent(root, fixed(20));
    expect(root.querySelector(".keep-with-next")).toBeNull();
  });

  it("marks the wrapper with what it ends in, so the sibling rules survive", () => {
    const withP = build("<h2>T</h2><p>B</p>");
    keepHeadingsWithContent(withP, fixed(20));
    expect(withP.querySelector(".keep-with-next")!.className).toContain("keep-with-next--p");

    const withPre = build("<h2>T</h2><pre>c</pre>");
    keepHeadingsWithContent(withPre, fixed(20));
    expect(withPre.querySelector(".keep-with-next")!.className).toContain("keep-with-next--pre");

    const withList = build("<h2>T</h2><ul><li>a</li></ul>");
    keepHeadingsWithContent(withList, fixed(20));
    expect(withList.querySelector(".keep-with-next")!.className).toBe("keep-with-next");
  });

  it("does not group what would not fit on a page anyway", () => {
    const root = build("<h2>Title</h2><pre>a very tall code block</pre>");
    // 600 px is past the 60 % of a page this is willing to hold together.
    keepHeadingsWithContent(root, fixed(600));
    expect(root.querySelector(".keep-with-next")).toBeNull();
  });

  it("still groups when there is no layout to measure", () => {
    // Skipping here would switch the feature off in silence whenever the
    // offscreen container has not been laid out yet — which is exactly what
    // happened, and made the E2E spec fail only when the whole suite ran.
    // Grouping something that turns out too tall is the milder failure:
    // paged.js just splits it, as it did before any of this existed.
    const root = build("<h2>Title</h2><p>Body</p>");
    keepHeadingsWithContent(root, fixed(0));
    expect(root.querySelector(".keep-with-next")).toBeTruthy();
  });

  it("preserves document order and every data-line", () => {
    const html = "<h1>A</h1><p>1</p><h2>B</h2><h3>C</h3><p>2</p><p>3</p>";
    const before = lines(build(html));

    const root = build(html);
    keepHeadingsWithContent(root, fixed(20));

    expect(lines(root)).toEqual(before);
    // Reverse sync walks up from the click target, so nesting must not hide it.
    const nested = root.querySelector(".keep-with-next h2");
    expect(nested!.closest("[data-line]")).toBe(nested);
  });
});
