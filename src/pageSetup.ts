/**
 * What the page is, in one place.
 *
 * The paper and its margins used to be written out separately in five: the
 * `@page` rules, the offscreen measuring container in `document-view.css`,
 * the page frame in `exportHtml.ts`, three pixel constants in
 * `previewRenderer.ts`, and the paper name the Rust print paths ask for. They
 * all meant A4 with 2.5 cm margins, and they said it in five different units.
 *
 * They now derive from here instead, and the `@page` rules are built by
 * `buildPagedCss` rather than living in a file at all. So this is no longer a
 * description of what those five agree on — it is where the answer is, and
 * changing a number here moves the Document view, the measuring pass, the
 * HTML export and the sheet the printer is asked for together.
 *
 * The drift it exists to prevent is still worth stating, because it is silent:
 * a document measured against one page and printed on another loses the right
 * edge of its tables, and nothing says so. `tableFitMetrics.test.ts` guards
 * the half of it that is still written out by hand — the table metrics that
 * `document-view.css` repeats from `paged.css` — and `pageSetup.test.ts`
 * guards the rest by asserting each file derives its page from here.
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
 * The paper a *document* asks for, or null when it asks for nothing this
 * build knows.
 *
 * Null rather than A4, and the difference is the whole reason this is not
 * `paperById`. A document that says nothing, or says something unrecognised,
 * must fall through to the preference the reader set; answering A4 here would
 * override their choice with a default on the strength of a typo.
 *
 * The spellings come from the two toolchains a Markdown writer is likely to
 * have met the key in: Pandoc's `papersize: a4` and `papersize: letter`, and
 * LaTeX's `a4paper` and `letterpaper` from `\documentclass`. `us-letter` is
 * accepted too, being what the PWG media name and several style guides call
 * it. Case and surrounding space are ignored.
 */
export function paperByName(name: string | null | undefined): Paper | null {
  if (!name) return null;
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^us[-_ ]?/, "")
    .replace(/[-_ ]?paper$/, "");
  return PAPERS[key as PaperId] ?? null;
}

/**
 * The narrowest and widest margin a document may ask for, in millimetres.
 *
 * Wider than the list Preferences offers, because a document is quoting a
 * house style rather than picking from a menu: half an inch and an inch and a
 * half are both real answers and neither is on that list.
 *
 * The floor is not arbitrary. The folio and the running title are `@page`
 * margin boxes and live in this white space; at 10 mm they still have room
 * for an 11 pt line, and the E2E spec prints at 10 mm and checks every page
 * still carries its number. Below that they start to be squeezed out, and a
 * page that silently loses its numbering is worse than one that ignores the
 * request.
 */
export const MIN_DOCUMENT_MARGIN_MM = 10;
export const MAX_DOCUMENT_MARGIN_MM = 40;

/**
 * The margin a *document* asks for, in millimetres, or null.
 *
 * Null when the document says nothing, says something unparseable, or asks
 * for a width outside the range above — and in each of those the reader's
 * preference decides, for the same reason `paperByName` answers null.
 *
 * Units: `mm`, `cm`, `in` and `pt`, with a bare number read as millimetres.
 * `in` because that is what Pandoc's `geometry: margin=1in` says and what a
 * writer who has met this key before is likely to type; `pt` because LaTeX
 * lengths are often written that way.
 */
export function marginByName(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value
    .trim()
    .toLowerCase()
    .match(new RegExp("^([0-9]+(?:[.][0-9]+)?)[ ]*(mm|cm|in|pt)?$"));
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const mm =
    match[2] === "cm"
      ? amount * 10
      : match[2] === "in"
        ? amount * MM_PER_INCH
        : match[2] === "pt"
          ? (amount * MM_PER_INCH) / 72
          : amount;
  if (mm < MIN_DOCUMENT_MARGIN_MM || mm > MAX_DOCUMENT_MARGIN_MM) return null;
  // Rounded to a tenth: an inch is 25.4 mm and there is no sense carrying
  // more precision than the page can show.
  return Math.round(mm * 10) / 10;
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
 * The `@page` rules for a given page, as text.
 *
 * Two blocks: the sheet everything is laid out on, and the sideways one a
 * table too wide for it is given. Both from the same paper, because a
 * document that printed its wide tables on a different sheet from the rest of
 * itself would be worse than one that clipped them.
 *
 * Deliberately as plain as CSS gets. paged.js does not use the browser's
 * parser — it runs the stylesheet through one of its own, which drops quietly
 * what it does not understand and does not resolve `var()` inside `@page`.
 * The lengths therefore have to be literals by the time they arrive, and
 * nothing clever may creep in here.
 */
function pageRules(metrics: PageMetrics): string {
  return [
    "@page {",
    `  size: ${metrics.paper.cssSize};`,
    `  margin: ${metrics.marginCss};`,
    "}",
    "",
    "@page landscape-table {",
    `  size: ${metrics.paper.cssSize} landscape;`,
    `  margin: ${metrics.marginCss};`,
    "}",
    "",
  ].join("\n");
}

/**
 * `paged.css` with the page it should describe in front of it.
 *
 * Generated and prepended, not written into the file. It used to be a string
 * rewrite — three regular expressions anchored to the start of a line —
 * and that was a bug that shipped: `paged.css` arrives here through
 * `?inline`, which Vite serves verbatim in development and **minifies on
 * build**, so in every built copy of the application the stylesheet was one
 * long line, no pattern matched, the guard fired, and the Document view and
 * the HTML export failed outright. Nothing caught it because the unit tests
 * read the file from disk and the E2E harness runs the dev server.
 *
 * So there is no longer anything to match. `paged.css` states no page size
 * and no page margin at all — deleting them is what stops somebody writing
 * them back in — and paged.js merges two `@page` rules with the same selector
 * (`modules/paged-media/atpage.js`: an existing selector reuses the page model
 * and only overwrites `size` when the rule carries one), so the block below
 * sizes the sheet and the one in the file adds its margin boxes to it.
 *
 * An empty `css` is not a special case any more: under vitest `?inline`
 * resolves to `""`, and prepending the rules to nothing is still the right
 * answer.
 */
export function buildPagedCss(css: string, metrics: PageMetrics = DEFAULT_PAGE): string {
  return pageRules(metrics) + css;
}
