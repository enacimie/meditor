/**
 * What the page is, in one place.
 *
 * The paper's dimensions are currently spelled out in five: the `@page` rules
 * in `paged.css`, the offscreen measuring container in `document-view.css`,
 * the page frame in `exportHtml.ts`, three pixel constants in
 * `previewRenderer.ts`, and the paper name the Rust print paths ask for. They
 * all mean A4 with 2.5 cm margins, and they say it in five different units.
 *
 * That repetition already has a test guarding it — `tableFitMetrics.test.ts`
 * exists because two of those blocks are one file and two hundred lines apart,
 * and its docblock spells out what happens when they drift: tables measured
 * against one set of numbers and printed with another, columns clipped off the
 * sheet and missing from the PDF with nothing to say so.
 *
 * This module is the arithmetic they should all be doing. It changes nothing
 * on its own — the numbers it produces are the numbers that are there today —
 * and it is what a second paper size can be added to without hunting.
 */

/** CSS pixels per inch, and per millimetre. The web's fixed conversion. */
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

/** Millimetres to CSS pixels, rounded the way a layout threshold wants. */
export function mmToPx(mm: number): number {
  return Math.round((mm * PX_PER_INCH) / MM_PER_INCH);
}

/** Millimetres to inches, which is what the Windows print API asks for. */
export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

/** A sheet of paper: its size in millimetres, and what each platform calls it. */
export type PaperId = "a4" | "letter";

export type Paper = {
  /** The id this application uses, and stores in preferences. */
  id: PaperId;
  widthMm: number;
  heightMm: number;
  /** The CSS `size` keyword, for `@page`. */
  cssSize: string;
  /** The PWG/IPP name GTK's `PaperSize::new` takes. */
  gtkName: string;
};

export const A4: Paper = {
  id: "a4",
  widthMm: 210,
  heightMm: 297,
  cssSize: "A4",
  gtkName: "iso_a4",
};

/**
 * US Letter: 8.5 × 11 inches, in the millimetres everything else here speaks.
 *
 * Wider than A4 and shorter, which is why it cannot be treated as a detail of
 * the print dialog: a document laid out for one and printed on the other does
 * not merely shift, it spills — the sheet is taller than the page and every
 * one of them takes two.
 */
export const LETTER: Paper = {
  id: "letter",
  widthMm: 215.9,
  heightMm: 279.4,
  cssSize: "Letter",
  gtkName: "na_letter",
};

export const PAPERS: Record<PaperId, Paper> = { a4: A4, letter: LETTER };

/** The paper a stored id names, falling back to A4 for anything unknown. */
export function paperById(id: string | undefined): Paper {
  return PAPERS[id as PaperId] ?? A4;
}

/**
 * The margin the Document view leaves around its content.
 *
 * One number, and the same on all four sides, which is what `paged.css` has
 * always said. A per-side margin is a bigger idea than this needs today.
 */
export const DEFAULT_MARGIN_MM = 25;

/**
 * The page as everything downstream needs it: what to write into the
 * stylesheets, and what to measure against.
 */
export type PageMetrics = {
  paper: Paper;
  marginMm: number;
  /** `210mm`, for the CSS that needs a length rather than a keyword. */
  widthCss: string;
  heightCss: string;
  marginCss: string;
  /** The content box, in CSS pixels, for the layout passes. */
  contentWidthPx: number;
  contentHeightPx: number;
  /** The same page turned sideways, which wide tables are given. */
  landscapeContentWidthPx: number;
};

export function pageMetrics(
  paper: Paper = A4,
  marginMm: number = DEFAULT_MARGIN_MM,
): PageMetrics {
  const contentWidthMm = paper.widthMm - marginMm * 2;
  const contentHeightMm = paper.heightMm - marginMm * 2;
  return {
    paper,
    marginMm,
    widthCss: `${paper.widthMm}mm`,
    heightCss: `${paper.heightMm}mm`,
    marginCss: `${marginMm / 10}cm`,
    contentWidthPx: mmToPx(contentWidthMm),
    contentHeightPx: mmToPx(contentHeightMm),
    // A landscape sheet is the same paper on its side, so its content is as
    // wide as a portrait page is tall. Derived rather than stated, which is
    // what keeps the two from disagreeing — they did, by a pixel, when they
    // were two constants: 934 in one file and 933 in the other for the same
    // 247 mm.
    landscapeContentWidthPx: mmToPx(contentHeightMm),
  };
}

/** The page as it ships, which is what every caller wants until it is asked. */
export const DEFAULT_PAGE = pageMetrics();

/**
 * `paged.css` with the page it should describe written into it.
 *
 * A string rewrite, because there is no other way in. `paged.css` never
 * reaches the document: paged.js is handed it as text and runs it through a
 * parser of its own, which does not resolve `var()` inside `@page` and drops
 * quietly what it does not understand. So the size has to be a literal by the
 * time it gets there.
 *
 * Four lines, and each replacement is asserted to have matched exactly once.
 * A silent miss here does not look like a bug: the document paginates against
 * one page and prints on another, which is the failure #89 measured on Linux.
 */
export function buildPagedCss(css: string, metrics: PageMetrics = DEFAULT_PAGE): string {
  /*
   * An empty stylesheet is not a stylesheet that lost its `@page`.
   *
   * `./paged.css?inline` resolves to an empty string under vitest, which does
   * not process CSS — the same reason `pagedMarginBoxes.test.ts` reads the
   * file from disk instead of importing it. Throwing there would fail tests
   * over the test runner rather than over the code.
   */
  if (css.trim() === "") return css;

  /**
   * Replace every match, and refuse to carry on if there were none.
   *
   * Counted with `match` rather than `test`: a global regex carries its
   * `lastIndex` between calls, and a guard that is sometimes right is worse
   * than no guard.
   */
  const rewrite = (text: string, pattern: RegExp, replacement: string, what: string) => {
    if ((text.match(pattern)?.length ?? 0) === 0) {
      throw new Error(
        `paged.css no longer declares ${what}: the page would silently stay A4 ` +
          "while everything else moved to the chosen paper",
      );
    }
    return text.replace(pattern, replacement);
  };

  let out = css;
  out = rewrite(out, /^(\s*)size:\s*A4;$/gm, `$1size: ${metrics.paper.cssSize};`, "its page size");
  out = rewrite(
    out,
    /^(\s*)size:\s*A4 landscape;$/gm,
    `$1size: ${metrics.paper.cssSize} landscape;`,
    "the landscape page size",
  );
  out = rewrite(out, /^(\s*)margin:\s*2\.5cm;$/gm, `$1margin: ${metrics.marginCss};`, "its margin");
  return out;
}
