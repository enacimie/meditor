import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";
import { A4, DEFAULT_MARGIN_MM, DEFAULT_PAGE, mmToInches, mmToPx, pageMetrics } from "./pageSetup";

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

  it("the offscreen measuring container is as wide as the paper", () => {
    // Not the content box: the container is the sheet, and the padding inside
    // it is what leaves the margin.
    const css = read("./preview/document-view.css");
    expect(css).toMatch(new RegExp(`width:\\s*${cm(A4.widthMm)}\\s*;`));
  });

  it("the HTML export frames the same sheet", () => {
    const source = read("./exportHtml.ts");
    expect(source).toContain(`max-width: ${cm(A4.widthMm)}`);
    expect(source).toContain(`min-height: ${cm(A4.heightMm)}`);
    expect(source).toContain(`padding: ${DEFAULT_PAGE.marginCss}`);
  });
});

describe("the defaults", () => {
  it("are A4 with 2.5 cm, which is what the project ships", () => {
    expect(DEFAULT_PAGE.paper).toBe(A4);
    expect(DEFAULT_MARGIN_MM).toBe(25);
  });
});
