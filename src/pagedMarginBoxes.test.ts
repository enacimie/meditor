/**
 * The folio and the running head are pure CSS, and that CSS is parsed by a
 * stranger.
 *
 * `paged.css` never reaches the document: paged.js is handed it as text and
 * runs it through its own engine while paginating. So these rules cannot be
 * checked the way a stylesheet normally is — nothing in the app applies them
 * — and a typo in one does not fail anywhere. It shows up as a page with no
 * number on it.
 *
 * These assertions are cheap, and they are about the source text, because the
 * source text is the input to that engine. What the rules actually do to a
 * page — where the box lands, what it says, which pages carry a head — is
 * measured against a real pagination in `tests/e2e/page-numbers.spec.mjs`.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";

// Read from disk rather than imported: vitest does not process CSS, so
// `./paged.css?inline` resolves to an empty string here and every assertion
// below would pass against nothing.
const pagedCss: string = readFileSync(new URL("./paged.css", import.meta.url), "utf8");

/** The body of the first `@page` block, margin boxes and all. */
function firstPageBlock(css: string): string {
  const start = css.indexOf("@page {");
  expect(start, "paged.css must declare a bare @page block").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unbalanced braces in the @page block");
}

/** The body of a named margin box inside a block. */
function marginBox(block: string, name: string): string {
  const start = block.indexOf(`@${name} {`);
  if (start === -1) return "";
  return block.slice(start, block.indexOf("}", start) + 1);
}

describe("the folio", () => {
  const block = firstPageBlock(pagedCss);

  it("numbers every page from the bottom centre", () => {
    const box = marginBox(block, "bottom-center");
    expect(box, "the @page block must carry a @bottom-center box").not.toBe("");
    expect(box).toMatch(/content:\s*counter\(page\)/);
  });

  it("says its own font and colour", () => {
    // The margin boxes live outside `.markdown-body.doc`, so they inherit the
    // interface rather than the paper: unstated, the number arrives in the UI
    // font and, in the dark theme, as light text on a white sheet.
    const box = marginBox(block, "bottom-center");
    expect(box).toMatch(/font-family:/);
    expect(box).toMatch(/color:\s*#000000/);
  });
});

describe("the running head", () => {
  it("is fed by the first heading, not by the markdown pipeline", () => {
    expect(pagedCss).toMatch(
      /\.markdown-body\.doc h1\s*\{[^}]*string-set:\s*doctitle content\(text\)/s,
    );
  });

  it("prints that string at the top centre", () => {
    const box = marginBox(firstPageBlock(pagedCss), "top-center");
    expect(box, "the @page block must carry a @top-center box").not.toBe("");
    expect(box).toMatch(/content:\s*string\(doctitle\)/);
  });

  it("is left off the first page, where the title itself already is", () => {
    const firstPage = pagedCss.slice(pagedCss.indexOf("@page :first"));
    expect(
      firstPage.startsWith("@page :first"),
      "paged.css must declare an @page :first block",
    ).toBe(true);
    expect(marginBox(firstPage, "top-center")).toMatch(/content:\s*none/);
  });
});
