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
export type Paper = {
  /** The id this application uses, and stores in preferences. */
  id: "a4";
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
