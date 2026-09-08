/**
 * E2E spec — a page break the author asked for actually ends the page.
 *
 * A unit test can say that `\newpage` becomes `<div class="page-break">`. It
 * cannot say the thing the feature exists for: that paged.js reads
 * `break-after: page` out of `paged.css` and starts a new sheet there. That
 * stylesheet never reaches the document — paged.js is handed it as text and
 * parses it with a parser of its own that quietly drops what it does not
 * understand — so nothing short of a real pagination says whether the rule
 * landed.
 *
 * And then the sheet is counted in the PDF as well, because the Document view
 * and the printed page have disagreed before.
 *
 * The document arrives through the shim rather than being typed: a DOM
 * selection does not reach CodeMirror, so typed text lands after the sample
 * instead of over it and the assertions measure both documents at once.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/*
 * Two short chapters that would sit on one page together, split by the break.
 * Short on purpose: if the filler alone could fill a page, a passing count
 * would say nothing about the break.
 */
const DOCUMENT = [
  "# Antes",
  "",
  "Un párrafo corto, de los que no llenan una página por sí solos.",
  "",
  "\\newpage",
  "",
  "# Después",
  "",
  "Otro párrafo corto, que sin el salto compartiría página con el anterior.",
  "",
].join("\n");

const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({
  docContent: DOCUMENT,
})};`;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The marker survives as an element, not as text ────────────────────
  await page.waitFor("!!document.querySelector('.page-break')", {
    timeout: 20000,
    message: "the break should reach the preview as an element",
  });

  // ── Pagination settles, and only then is it counted ───────────────────
  // paged.js lays pages out one at a time, so a count taken the moment the
  // second page appears is not the count the printer will see. The idiom is
  // page-numbers.spec's.
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__pageBreakPages ?? -1;
      window.__pageBreakPages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 40000, interval: 500, message: "pagination should settle before it is counted" },
  );

  // The headings are found as elements rather than by id: the slug keeps
  // accents, so guessing at one from the Spanish text is guessing.
  const layout = await page.read(`(() => {
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    const headings = [...document.querySelectorAll('.pagedjs_page h1')];
    const sheetOf = (el) => {
      const sheet = el && el.closest('.pagedjs_page');
      return sheet ? pages.indexOf(sheet) : -1;
    };
    return {
      pages: pages.length,
      headings: headings.map((h) => h.textContent.trim()),
      before: sheetOf(headings[0]),
      after: sheetOf(headings[1]),
      breakSheet: sheetOf(document.querySelector('.pagedjs_page .page-break')),
    };
  })()`);

  assert(
    layout.pages === 2,
    `two short chapters split by a break should make two pages, got ${layout.pages}`,
  );
  assert(
    layout.before === 0 && layout.after === 1,
    `the heading after the break should start the second page, got ${JSON.stringify(layout)}`,
  );

  // ── And the printer agrees ────────────────────────────────────────────
  const pdfRes = await page.send("Page.printToPDF", {
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pdf = Buffer.from(pdfRes.result.data, "base64").toString("latin1");
  const printed = (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  assert(
    printed === layout.pages,
    `the PDF should have one sheet per paginated page (${layout.pages}), got ${printed}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while paginating a break: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    "PASS: page-break.spec — the break ends the page, the next heading starts the " +
      "second, and the PDF has both sheets",
  );
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
