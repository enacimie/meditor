/**
 * The offscreen container that `fitWideTables` measures must be styled like
 * the paper, or the measurement answers a question nobody asked.
 *
 * `paged.css` never reaches the document: paged.js parses it and injects its
 * own copy, and only while it paginates. So at measuring time the tables in
 * `.preview-source` fall back to `Preview.css`'s screen rules, which is why
 * the metrics are repeated there. The repetition is the fragile part — the two
 * blocks are 200 lines and one file apart — so this asserts they agree. Let
 * them drift and nothing looks broken: tables are measured against one set of
 * numbers and printed with another, and the ones that overflow are clipped at
 * the sheet edge with their last columns missing from the PDF.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";

// Read from disk rather than imported: vitest does not process CSS, so
// `./paged.css?inline` resolves to an empty string here and every assertion
// below would pass against nothing.
const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const pagedCss = read("./paged.css");
const previewCss = read("./Preview.css");

/** Selector (whitespace-normalised) to declaration body. */
function rules(css: string): Map<string, string> {
  const map = new Map<string, string>();
  // Before splitting, not after: a comment here quotes `{ overflow: hidden }`,
  // and a brace inside one would tear the block apart.
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const brace = block.indexOf("{");
    if (brace === -1) continue;
    const selector = block.slice(0, brace).replace(/\s+/g, " ").trim();
    if (!selector || selector.startsWith("@")) continue;
    map.set(selector, block.slice(brace + 1));
  }
  return map;
}

function declaration(body: string | undefined, property: string): string | null {
  if (body === undefined) return null;
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon !== -1 && part.slice(0, colon).trim() === property) {
      return part.slice(colon + 1).trim();
    }
  }
  return null;
}

describe("the measuring container matches the page", () => {
  const paged = rules(pagedCss);
  const preview = rules(previewCss);

  /** [step, table selector on the page, table selector in the container] */
  const STATES: [string, string, string][] = [
    ["no step", ".markdown-body.doc table", ".preview-source.markdown-body table"],
    ...["table-fit-1", "table-fit-2", "table-fit-3"].map(
      (step): [string, string, string] => [
        step,
        `.markdown-body.doc table.${step}`,
        `.preview-source.markdown-body table.${step}`,
      ],
    ),
  ];

  it.each(STATES)("agrees on the type size at %s", (_step, onPage, inContainer) => {
    const expected = declaration(paged.get(onPage), "font-size");
    expect(expected).not.toBeNull();
    expect(declaration(preview.get(inContainer), "font-size")).toBe(expected);
  });

  it.each(STATES)("agrees on the cell padding at %s", (step, onPage, inContainer) => {
    const cells = (selector: string) =>
      step === "no step"
        ? `${selector.replace(" table", " th")}, ${selector.replace(" table", " td")}`
        : `${selector} th, ${selector} td`;

    const expected = declaration(paged.get(cells(onPage)), "padding");
    expect(expected).not.toBeNull();
    expect(declaration(preview.get(cells(inContainer)), "padding")).toBe(expected);
  });

  it("keeps the container laid out as a table rather than a scrolling box", () => {
    // `Preview.css` gives every table `display: block; overflow: auto` so the
    // web view can scroll one sideways. Left in place here it would measure a
    // scroll box, not a table, and the answer would mean nothing.
    const container = preview.get(".preview-source.markdown-body table");
    expect(declaration(container, "display")).toBe("table");
    expect(declaration(container, "overflow")).toBe("visible");
    expect(declaration(container, "border-collapse")).toBe(
      declaration(paged.get(".markdown-body.doc table"), "border-collapse"),
    );
  });

  it("drops the cell borders the page does not have", () => {
    // Seventeen collapsed 1 px borders are 18 px of width the page never
    // spends — small, but it is spent in the direction that hides an overflow.
    expect(
      declaration(preview.get(".preview-source.markdown-body th, .preview-source.markdown-body td"), "border"),
    ).toBe("none");
  });
});
