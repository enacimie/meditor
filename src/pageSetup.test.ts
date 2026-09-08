import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";
import {
  A4,
  DEFAULT_MARGIN_MM,
  DEFAULT_PAGE,
  LETTER,
  buildPagedCss,
  mmToInches,
  mmToPx,
  pageMetrics,
  paperById,
} from "./pageSetup";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("the page geometry", () => {
  it("converts millimetres to CSS pixels at 96 dpi", () => {
    // The web's fixed conversion, not a screen's. 25.4 mm is one inch.
    expect(mmToPx(25.4)).toBe(96);
    expect(mmToPx(210)).toBe(794);
    expect(mmToInches(25.4)).toBeCloseTo(1, 10);
  });

  it("gives A4 the content box the layout passes have always used", () => {
    // 605 and 934 are the numbers `previewRenderer` carried as constants, and
    // they are what the table-fitting and heading-grouping decisions compare
    // against. This is the assertion that says the arithmetic here reproduces
    // them rather than approximating them.
    expect(DEFAULT_PAGE.contentWidthPx).toBe(605);
    expect(DEFAULT_PAGE.contentHeightPx).toBe(934);
  });

  it("makes a landscape page as wide as a portrait one is tall", () => {
    // The same 247 mm, so the same number. As two hand-written constants they
    // disagreed by a pixel — 934 for the height, 933 for the landscape width.
    expect(DEFAULT_PAGE.landscapeContentWidthPx).toBe(DEFAULT_PAGE.contentHeightPx);
    expect(DEFAULT_PAGE.landscapeContentWidthPx).toBe(934);
  });

  it("takes the margin off both sides", () => {
    const wide = pageMetrics(A4, 0);
    expect(wide.contentWidthPx).toBe(mmToPx(210));
    expect(wide.contentHeightPx).toBe(mmToPx(297));
  });

  it("writes the margin the way a stylesheet spells it", () => {
    expect(DEFAULT_PAGE.marginCss).toBe("2.5cm");
    expect(pageMetrics(A4, 20).marginCss).toBe("2cm");
  });
});

describe("the stylesheets agree with it", () => {
  /*
   * The point of the module. These files each state the page in their own
   * units, and nothing has ever compared them to one source — only to each
   * other, and only for the table metrics. A margin changed in one and not the
   * others is a document measured against one page and printed on another.
   */

  it("paged.css asks for the paper and margin this module describes", () => {
    const css = read("./paged.css");
    expect(css).toMatch(new RegExp(`size:\\s*${A4.cssSize}\\s*;`, "i"));
    expect(css).toMatch(new RegExp(`margin:\\s*${DEFAULT_PAGE.marginCss}\\s*;`));
  });

  /**
   * The paper's own dimensions as a stylesheet spells them: `21cm`, `29.7cm`.
   *
   * Derived, not written out. Written out, these assertions would keep passing
   * while the module and the stylesheets described different sheets — which is
   * the one thing they exist to catch.
   */
  const cm = (mm: number) => `${Number((mm / 10).toFixed(2))}cm`;

  it("the offscreen measuring container takes its width from the page", () => {
    // It used to state `21cm` outright. Preview now sets `--doc-sheet-width`
    // from the metrics, so a Letter document is measured against a Letter
    // sheet — and the literal left here is the fallback, which still has to be
    // the paper this file was written for.
    const css = read("./preview/document-view.css");
    expect(css).toMatch(
      new RegExp(`width:\\s*var\\(--doc-sheet-width,\\s*${cm(A4.widthMm)}\\)`),
    );
  });

  it("the HTML export builds its frame from the page rather than stating it", () => {
    // The assertion that survives templating: no hand-written sheet size may
    // remain, because a document on Letter would then be framed as A4.
    const source = read("./exportHtml.ts");
    expect(source).toContain("max-width: ${metrics.widthCss}");
    expect(source).toContain("min-height: ${metrics.heightCss}");
    expect(source).toContain("padding: ${metrics.marginCss}");
    // A physical length, specifically. `max-width: 100%` is not a sheet size
    // and there are three of them in that stylesheet.
    expect(source).not.toMatch(/max-width:\s*\d+(\.\d+)?(cm|mm|in)\b/);
  });
});

describe("the defaults", () => {
  it("are A4 with 2.5 cm, which is what the project ships", () => {
    expect(DEFAULT_PAGE.paper).toBe(A4);
    expect(DEFAULT_MARGIN_MM).toBe(25);
  });
});

describe("Letter", () => {
  it("is 8.5 by 11 inches, in millimetres", () => {
    expect(LETTER.widthMm).toBeCloseTo(mmToInches(LETTER.widthMm) * 25.4, 6);
    expect(mmToInches(LETTER.widthMm)).toBeCloseTo(8.5, 3);
    expect(mmToInches(LETTER.heightMm)).toBeCloseTo(11, 3);
  });

  it("is wider than A4 and shorter, which is the whole problem", () => {
    // Not a detail of the print dialog: a sheet laid out for one and printed
    // on the other does not shift, it spills.
    const letter = pageMetrics(LETTER);
    expect(letter.contentWidthPx).toBeGreaterThan(DEFAULT_PAGE.contentWidthPx);
    expect(letter.contentHeightPx).toBeLessThan(DEFAULT_PAGE.contentHeightPx);
  });

  it("is what a stored id resolves to, and anything else is A4", () => {
    expect(paperById("letter")).toBe(LETTER);
    expect(paperById("a4")).toBe(A4);
    expect(paperById("foolscap")).toBe(A4);
    expect(paperById(undefined)).toBe(A4);
  });
});

describe("writing the page into paged.css", () => {
  const css = read("./paged.css");

  it("leaves it alone for the paper it already describes", () => {
    expect(buildPagedCss(css, DEFAULT_PAGE)).toBe(css);
  });

  it("rewrites both page sizes for Letter", () => {
    const out = buildPagedCss(css, pageMetrics(LETTER));
    expect(out).toContain("size: Letter;");
    expect(out).toContain("size: Letter landscape;");
    // The landscape block is the one that is easy to forget, and forgetting it
    // gives a document whose wide tables print on a different sheet from the
    // rest of it. Asserted on the declarations rather than on the whole file:
    // the prose is allowed to mention A4 as an example, and once did.
    const sizes = [...out.matchAll(/^\s*size:\s*(.+);$/gm)].map((m) => m[1]);
    expect(sizes).toEqual(["Letter", "Letter landscape"]);
  });

  it("rewrites the margin", () => {
    const out = buildPagedCss(css, pageMetrics(A4, 20));
    expect(out).toContain("margin: 2cm;");
    expect(out).not.toContain("margin: 2.5cm;");
  });

  it("refuses to work on a stylesheet that has stopped saying its size", () => {
    // The failure this exists to prevent is silence: a replacement that
    // matches nothing leaves the page A4 while the measuring, the export and
    // the printer all move to Letter, and nothing looks wrong until the PDF
    // has twice the pages.
    expect(() => buildPagedCss("@page { margin: 2.5cm; }", pageMetrics(LETTER))).toThrow(
      /page size/,
    );
  });
});
