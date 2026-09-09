/**
 * E2E spec — the page margin, on real pages.
 *
 * The margin is written into `paged.css` as text before paged.js is handed
 * it, and `paged.css` never becomes a stylesheet in the document. So no unit
 * test can say whether the number in Preferences reached the sheet: the only
 * witness is a pagination that actually happened.
 *
 * Two things are checked, and both are needed. The gap between the sheet and
 * the text, and the size of the text box, say the margin was applied. How
 * much of the document fitted on the first sheet says it was applied before
 * the text was laid out rather than after — a frame that moves afterwards
 * insets the same words.
 *
 * The spec only reads the sample document and restores the stored preferences
 * on the way out, so it leaves the session as it found it.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFS_KEY = "meditor.preferences.v1";
/** 96 CSS pixels to the inch, so a millimetre is this many. */
const PX_PER_MM = 96 / 25.4;
/** The sample is laid out on the default paper. */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

const page = await connect(CDP_PORT);

/**
 * Wait for the Document view to finish paginating, then measure it.
 *
 * Settled means "the count stopped changing", not "a second page appeared":
 * paged.js lays the pages out one at a time, and a count read the moment the
 * document becomes plural is not the count the printer will see. The idiom is
 * page-numbers.spec's, and it is there because the shorter version reported
 * four pages for a seven-page document on CI.
 */
async function measurePages(label) {
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__marginPages ?? -1;
      window.__marginPages = n;
      return n > 1 && n === previous;
    })()`,
    {
      timeout: 40000,
      interval: 500,
      message: `pagination should settle before it is measured (${label})`,
    },
  );
  return page.evaluate(`(() => {
    const first = document.querySelector('.pagedjs_page');
    const sheet = first.querySelector('.pagedjs_sheet');
    const area = first.querySelector('.pagedjs_area');
    const s = sheet.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    return {
      pages: document.querySelectorAll('.pagedjs_page').length,
      // The white space the text is inset by, on the two sides that are
      // easiest to read off a rectangle.
      left: a.left - s.left,
      top: a.top - s.top,
      // The text box itself, which is what the lines are broken against.
      width: a.width,
      height: a.height,
      // How much of the document fitted on the first sheet. This is the half
      // that says the margin was applied before the text was laid out: a
      // frame that moves after the fact insets the same words.
      firstPageChars: area.textContent.replace(/\\s+/g, ' ').trim().length,
      /*
       * And the offscreen box the layout passes measure in.
       *
       * \`keepHeadingsWithContent\` reads block heights out of it and compares
       * them against a share of the page. A height depends on the width the
       * text wraps in, so that box has to be the text column: measured in the
       * whole sheet, every block came out shorter than it would really be,
       * and the error grew with the margin.
       */
      measuringWidth: (() => {
        const source = document.querySelector('.preview-source');
        if (!source) return null;
        const box = source.getBoundingClientRect();
        const style = getComputedStyle(source);
        return box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      })(),
    };
  })()`);
}

/** Store a margin and reload, which is when preferences are read. */
async function useMargin(mm) {
  await page.evaluate(
    `(() => {
      const stored = JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}) || '{}');
      stored.pageMarginMm = ${mm};
      localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify(stored));
      return true;
    })()`,
  );
  await page.reload();
  return measurePages(`${mm} mm`);
}

/** Within a pixel and a half of the millimetres asked for. */
function closeTo(px, mm, what) {
  const expected = mm * PX_PER_MM;
  assert(
    Math.abs(px - expected) < 1.5,
    `${what}: expected about ${expected.toFixed(1)}px for ${mm} mm, got ${px.toFixed(1)}px`,
  );
}

try {
  await page.freshPage(BASE_URL);
  /*
   * Start from no stored preference, and reload so the absence is read.
   *
   * The specs share one browser and one localStorage, so "the default" is
   * whatever the last spec left behind — and this one writes margins. Without
   * this line a failed run poisons the next: the 15 mm it stored became the
   * baseline, six pages were compared against six, and the assertion that
   * fewer sheets are needed failed on a page count that was correct.
   */
  await page.evaluate(`localStorage.removeItem(${JSON.stringify(PREFS_KEY)}); true`);
  await page.reload();

  // ── The margin the project ships with ─────────────────────────────
  const normal = await measurePages("default");
  closeTo(normal.left, 25, "the default left margin");
  closeTo(normal.top, 25, "the default top margin");
  closeTo(normal.width, A4_WIDTH_MM - 50, "the default text box");
  closeTo(normal.height, A4_HEIGHT_MM - 50, "the default text box");
  closeTo(normal.measuringWidth, A4_WIDTH_MM - 50, "the default measuring box");

  // ── A wider margin: less room, so more pages ──────────────────────
  const wide = await useMargin(35);
  closeTo(wide.left, 35, "the wide left margin");
  closeTo(wide.top, 35, "the wide top margin");
  closeTo(wide.width, A4_WIDTH_MM - 70, "the wide text box");
  closeTo(wide.height, A4_HEIGHT_MM - 70, "the wide text box");
  // The one that used to be wrong, and wrong by more the wider the margin:
  // the box the layout passes measure in has to be the column, not the sheet.
  closeTo(wide.measuringWidth, A4_WIDTH_MM - 70, "the wide measuring box");
  assert(
    wide.width < normal.width && wide.height < normal.height,
    `a wider margin has to leave a smaller text box, got ` +
      `${wide.width}x${wide.height} against ${normal.width}x${normal.height}`,
  );

  // ── A narrower one: more room, so fewer ───────────────────────────
  const narrow = await useMargin(15);
  closeTo(narrow.left, 15, "the narrow left margin");
  closeTo(narrow.top, 15, "the narrow top margin");
  closeTo(narrow.width, A4_WIDTH_MM - 30, "the narrow text box");
  closeTo(narrow.height, A4_HEIGHT_MM - 30, "the narrow text box");
  closeTo(narrow.measuringWidth, A4_WIDTH_MM - 30, "the narrow measuring box");
  /*
   * And the document was actually laid out against that box rather than
   * merely framed by it. Checked between 15 mm and 25 mm and not between 25
   * and 35, because the sample's first page ends at a block that will not fit
   * either way: it holds the same 532 characters at both, and a test written
   * on the wider pair would pass whether the text reflowed or not.
   */
  assert(
    narrow.firstPageChars > normal.firstPageChars,
    `15 mm leaves more room than 25 mm, so more of the document should fit on ` +
      `the first sheet: ${narrow.firstPageChars} characters against ${normal.firstPageChars}`,
  );
  assert(
    narrow.pages < normal.pages,
    `and the whole document should need fewer sheets: ${narrow.pages} against ${normal.pages}`,
  );

  // ── The folio still has somewhere to sit at the narrowest ─────────
  // The reason the list of margins has a floor: the page number and the
  // running title are `@page` margin boxes, and they live in this space.
  const folio = await page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    return pages.map((p) => {
      const box = p.querySelector('.pagedjs_margin-bottom-center');
      return box ? box.classList.contains('hasContent') : false;
    });
  })()`);
  assert(
    folio.length > 1 && folio.every(Boolean),
    `every page should still carry its number at 15 mm, got ${JSON.stringify(folio)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `PASS: page-margin.spec — the sheet is inset by the millimetres asked for ` +
      `and the text reflows: first page holds ${narrow.firstPageChars} characters ` +
      `at 15 mm, ${normal.firstPageChars} at 25, ${wide.firstPageChars} at 35 ` +
      `(${narrow.pages}/${normal.pages}/${wide.pages} pages), and the folio ` +
      `survives the narrowest`,
  );
} finally {
  /*
   * Put the stored preferences back whatever happened, and especially when
   * something did.
   *
   * The specs share one browser and one localStorage, and this is the only
   * one that writes a margin. A failure between the write and the cleanup
   * would hand the next spec — page-numbers, which measures the folio against
   * the 2.5 cm margin it expects — a document laid out on 15 mm, and it would
   * report the difference as a defect of its own. Cleaning up only on the
   * happy path is how one red spec becomes two.
   */
  try {
    await page.evaluate(`localStorage.removeItem(${JSON.stringify(PREFS_KEY)}); true`);
  } catch {
    // The page may already be gone; there is nothing further to do here.
  }
  page.close();
}
