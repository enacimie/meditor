// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  splitLongFencedBlocks,
  keepHeadingsWithContent,
  fitWideTables,
  findAnchorTarget,
} from "./previewRenderer";

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

/* ---- fitWideTables ---- */
describe("fitWideTables", () => {
  const STEPS = ["table-fit-1", "table-fit-2", "table-fit-3"];

  function build(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  }

  const table = (cols: number) =>
    `<table><thead><tr>${"<th>h</th>".repeat(cols)}</tr></thead></table>`;

  /** jsdom lays nothing out, so widths come from here instead of offsetWidth. */
  const fixed = (px: number) => () => px;

  const stepOf = (root: HTMLElement) =>
    STEPS.find((s) => root.querySelector("table")!.classList.contains(s)) ?? null;

  /**
   * Stands in for the stylesheet the real measure reads through: each step
   * buys `saving` px, so a table that starts far enough out needs several.
   */
  const shrinking = (natural: number, saving: number) => (el: HTMLElement) =>
    natural - (STEPS.findIndex((s) => el.classList.contains(s)) + 1) * saving;

  it("leaves a table that already fits alone", () => {
    const root = build(table(3));
    fitWideTables(root, fixed(400));
    expect(stepOf(root)).toBeNull();
  });

  it("leaves a table that fills the page exactly alone", () => {
    const root = build(table(8));
    fitWideTables(root, fixed(605));
    expect(stepOf(root)).toBeNull();
  });

  it("escalates only as far as it has to", () => {
    const root = build(table(17));
    fitWideTables(root, shrinking(700, 200));
    expect(stepOf(root)).toBe("table-fit-1");
  });

  it("keeps going while the table is still too wide", () => {
    const root = build(table(17));
    fitWideTables(root, shrinking(1000, 200));
    expect(stepOf(root)).toBe("table-fit-2");
  });

  it("settles on the smallest step when nothing is enough", () => {
    const root = build(table(40));
    fitWideTables(root, shrinking(4000, 200));
    expect(stepOf(root)).toBe("table-fit-3");
  });

  it("squeezes when there is no layout to measure", () => {
    // The opposite call to the one keepHeadingsWithContent makes, on purpose.
    // There, skipping an unmeasurable case switched a nicety off in silence;
    // here it would let a table run off the paper, and paged.js clips at the
    // sheet edge in print too — the lost columns are simply absent from the
    // PDF with nothing to say so. Squeezing a narrow table that never needed
    // it is only ugly, so an unmeasurable one gets the smallest type.
    const root = build(table(3));
    fitWideTables(root, fixed(0));
    expect(stepOf(root)).toBe("table-fit-3");
    expect(root.querySelector("table")!.classList.contains("needs-landscape")).toBe(false);
  });

  it("claims the wider sheet too when it cannot be measured and the user opted in", () => {
    // Zero means "no layout to measure", not "narrow" — and a table that
    // cannot be measured cannot be trusted to fit a portrait page either.
    // The next render re-decides from scratch, so a table that turns out to
    // fit is unmarked as soon as there is something to measure.
    const root = build(table(17));
    fitWideTables(root, fixed(0), true, "Landscape page");
    const el = root.querySelector("table")!;
    expect(stepOf(root)).toBe("table-fit-3");
    expect(el.classList.contains("needs-landscape")).toBe(true);
    expect(el.getAttribute("data-landscape-note")).toBe("Landscape page");
  });

  it("re-decides from scratch when the document changes", () => {
    // The pass runs on every render, so a table that was wide and has since
    // been edited down must lose the class it was given rather than keep
    // being rendered small for the rest of the session.
    const root = build(table(17));
    fitWideTables(root, fixed(4000));
    expect(stepOf(root)).toBe("table-fit-3");

    fitWideTables(root, fixed(400));
    expect(stepOf(root)).toBeNull();
  });

  it("judges each table on its own", () => {
    const root = build(`${table(2)}${table(17)}`);
    const wide = (el: HTMLElement) => (el.querySelectorAll("th").length > 2 ? 900 : 90);
    fitWideTables(root, wide);

    const [narrow, big] = [...root.querySelectorAll("table")];
    expect(STEPS.some((s) => narrow.classList.contains(s))).toBe(false);
    expect(big.classList.contains("table-fit-3")).toBe(true);
  });

  it("adds nothing to the tree but a class", () => {
    // Reverse sync walks up from the click target to the nearest [data-line],
    // which markdown-it puts on the table and its rows. A wrapper here would
    // be harmless; moving or replacing anything would not.
    const html = `<table data-line="4"><tbody><tr data-line="5"><td>a</td></tr></tbody></table>`;
    const root = build(html);
    const before = root.querySelector("table");

    fitWideTables(root, fixed(900));

    expect(root.querySelector("table")).toBe(before);
    expect(root.querySelector("tr")!.getAttribute("data-line")).toBe("5");
    expect(root.children.length).toBe(1);
  });

  /* ---- landscape opt-in ---- */

  it("never marks a landscape page without the opt-in", () => {
    // 800 px fits landscape (933) but no portrait step (605): with the flag
    // off it stays at the smallest step, clipped as before.
    const root = build(table(17));
    fitWideTables(root, fixed(800));
    expect(root.querySelector("table")!.classList.contains("needs-landscape")).toBe(false);
    expect(stepOf(root)).toBe("table-fit-3");
  });

  it("marks a table that fits landscape but no portrait step", () => {
    const root = build(table(17));
    fitWideTables(root, fixed(800), true, "Landscape page");
    const el = root.querySelector("table")!;
    expect(el.classList.contains("needs-landscape")).toBe(true);
    expect(el.getAttribute("data-landscape-note")).toBe("Landscape page");
  });

  it("leaves a table too wide even for landscape alone", () => {
    // 1200 px does not fit the 933 px landscape sheet either — splitting it is
    // the author's decision, not the editor's.
    const root = build(table(40));
    fitWideTables(root, fixed(1200), true, "Landscape page");
    expect(root.querySelector("table")!.classList.contains("needs-landscape")).toBe(false);
    expect(stepOf(root)).toBe("table-fit-3");
  });

  it("prefers a fitting portrait step over landscape", () => {
    // Rotation costs the reader more than 9pt type; landscape is the last
    // resort, so a table table-fit-1 can save never gets the page turned.
    const root = build(table(17));
    fitWideTables(root, shrinking(700, 200), true, "Landscape page");
    expect(stepOf(root)).toBe("table-fit-1");
    expect(root.querySelector("table")!.classList.contains("needs-landscape")).toBe(false);
  });

  it("clears the landscape mark when the table narrows", () => {
    const root = build(table(17));
    fitWideTables(root, fixed(800), true, "Landscape page");
    expect(root.querySelector("table")!.classList.contains("needs-landscape")).toBe(true);

    fitWideTables(root, fixed(400), true, "Landscape page");
    expect(root.querySelector("table")!.classList.contains("needs-landscape")).toBe(false);
  });
});

/* ---- findAnchorTarget ---- */
describe("findAnchorTarget", () => {
  /** A container holding one heading with the given id. */
  const withHeading = (id: string) => {
    const root = document.createElement("div");
    root.innerHTML = `<h2 id="${id}">A heading</h2><p>text</p>`;
    return root;
  };

  it("finds a plain ASCII heading", () => {
    const root = withHeading("introduction");
    expect(findAnchorTarget(root, "#introduction")).toBe(root.querySelector("h2"));
  });

  it("finds a heading whose href arrived percent-encoded", () => {
    // The defect this exists for. markdown-it writes `[x](#sección)` out as
    // `#secci%C3%B3n`, and handing that straight to querySelector throws,
    // which used to look exactly like a link with no target.
    const root = withHeading("sección");
    expect(findAnchorTarget(root, "#secci%C3%B3n")).toBe(root.querySelector("h2"));
  });

  it("finds an id that is not a valid selector on its own", () => {
    // "1. Introducción" is a perfectly good id and nonsense as a selector.
    const root = withHeading("1. introducción");
    expect(findAnchorTarget(root, "#1.%20introducci%C3%B3n")).toBe(
      root.querySelector("h2"),
    );
  });

  it("returns null when nothing carries that id", () => {
    expect(findAnchorTarget(withHeading("introduction"), "#missing")).toBeNull();
  });

  it("returns null for a malformed escape rather than throwing", () => {
    expect(findAnchorTarget(withHeading("introduction"), "#%zz")).toBeNull();
  });

  it("returns null for a bare hash and for a href that is not one", () => {
    const root = withHeading("introduction");
    expect(findAnchorTarget(root, "#")).toBeNull();
    expect(findAnchorTarget(root, "https://example.com")).toBeNull();
  });

  it("returns null without a container", () => {
    expect(findAnchorTarget(null, "#introduction")).toBeNull();
  });
});
