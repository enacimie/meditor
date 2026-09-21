/**
 * What came out of the printer, as opposed to what the view drew.
 *
 * The Document view and the printed sheet are not the same claim. paged.js
 * lays the pages out with a parser of its own, reading `paged.css` as text,
 * and the browser prints from the `@page` rules it finds in the document. A
 * geometry that reaches one and not the other looks perfect on screen and
 * comes out on the wrong paper — which is how the Document view shipped
 * broken in every built copy until #110: right in the view, wrong in the
 * thing handed over.
 *
 * So a spec that measures the sheet in the DOM has only made half the
 * assertion. This is the other half.
 */

/** A4 and Letter in PostScript points, which is what a `/MediaBox` is in. */
export const A4_PT = [595, 842];
export const LETTER_PT = [612, 792];

/**
 * Print the page as it stands and read the sheets back out of the PDF.
 *
 * `preferCSSPageSize` is the whole point: without it the browser prints on
 * its own default paper and the document's `@page` size is ignored, so the
 * assertion would pass for the wrong reason on any machine whose default
 * happens to match.
 */
export async function printSheets(page) {
  const res = await page.send("Page.printToPDF", {
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pdf = Buffer.from(res.result.data, "base64").toString("latin1");
  return {
    // `/Type /Page` and not `/Pages`, which is the tree node above them.
    sheets: (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length,
    boxes: [
      ...pdf.matchAll(
        /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/g,
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]),
  };
}

/**
 * Every printed sheet is the paper named, within the rounding a PDF does.
 *
 * Three points of tolerance, the same as page-numbers.spec has used since
 * it was written: enough for the conversion, far short of the 17 mm that
 * separates A4 from Letter.
 */
export function assertPaper(assert, boxes, [widthPt, heightPt], label) {
  assert(
    boxes.length > 0 &&
      boxes.every(
        ([w, h]) => Math.abs(w - widthPt) < 3 && Math.abs(h - heightPt) < 3,
      ),
    `${label}: every sheet should be ${widthPt}x${heightPt} pt, got ` +
      `${JSON.stringify(boxes.slice(0, 3))}`,
  );
}
