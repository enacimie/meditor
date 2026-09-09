/**
 * E2E spec — the page a document asks for, against a reader who wants another.
 *
 * `papersize` and `margin` in the front-matter are the document's own answer
 * to what it is, and they have to beat the preference, which is the reader's
 * answer to what is in their printer. Nothing short of a real pagination can
 * say whether they did: `paged.css` never becomes a stylesheet in the
 * document — paged.js is handed it as text and parses it with an engine of
 * its own — so the sheet these values produce exists only after a layout.
 *
 * The preference is deliberately set to the opposite of everything the
 * document says, so a passing run cannot be a default agreeing with itself.
 *
 * The document arrives through the shim rather than being typed: a DOM
 * selection does not reach CodeMirror, so typed text lands after the sample
 * instead of over it.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFS_KEY = "meditor.preferences.v1";
const PX_PER_MM = 96 / 25.4;

/** What the document asks for, in the units a writer would type. */
const DOC_MARGIN_MM = 10;
const LETTER_WIDTH_MM = 215.9;
const LETTER_HEIGHT_MM = 279.4;

/*
 * Long enough to take more than one sheet, so the folio has to appear on a
 * page that is not the first — the running head is suppressed on page one,
 * and a single-page document would prove nothing about either box.
 */
const BODY = Array.from(
  { length: 40 },
  (_, i) =>
    `Párrafo ${i + 1}. Texto de relleno suficiente para que el documento ocupe ` +
    "más de una hoja y las cajas de margen tengan que aparecer en varias.",
).join("\n\n");

const DOCUMENT = [
  "---",
  "title: Un documento con su propia página",
  "papersize: letter",
  `margin: ${DOC_MARGIN_MM}mm`,
  "---",
  "",
  "# Capítulo",
  "",
  BODY,
  "",
].join("\n");

const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

/*
 * The opposite of everything the document says: the widest margin the dialog
 * offers, on the other paper.
 */
const CONTRARY_PREFERENCES = `try {
  localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({
    paperSize: "a4",
    pageMarginMm: 35,
  }));
} catch {}`;

/** Within a pixel and a half of the millimetres asked for. */
function closeTo(px, mm, what) {
  const expected = mm * PX_PER_MM;
  assert(
    Math.abs(px - expected) < 1.5,
    `${what}: expected about ${expected.toFixed(1)}px for ${mm} mm, got ${px.toFixed(1)}px`,
  );
}

const page = await connect(CDP_PORT);
let configId;
let prefsId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  prefsId = await page.addInitScript(CONTRARY_PREFERENCES);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  /*
   * Read the contrary preference back before believing in it.
   *
   * It is seeded by an init script wrapped in `try {} catch {}`, so a storage
   * that refused the write would fail silently and the application would boot
   * on the defaults — A4 and 25 mm. Every assertion below would still pass,
   * because they discriminate Letter from A4 and 10 mm from 25 either way,
   * and the spec would go on printing "beat a preference set to A4 and 35 mm"
   * having proved only "beat the default".
   */
  const stored = await page.evaluate(
    `JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}) || "null")`,
  );
  assert(
    stored && stored.paperSize === "a4" && stored.pageMarginMm === 35,
    `the contrary preference should be stored, got ${JSON.stringify(stored)}`,
  );

  // Settled, not merely plural: paged.js lays the pages out one at a time.
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__documentPagePages ?? -1;
      window.__documentPagePages = n;
      return n > 1 && n === previous;
    })()`,
    {
      timeout: 40000,
      interval: 500,
      message: "the document should paginate onto more than one sheet and settle",
    },
  );

  const measured = await page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    const first = pages[0];
    const sheet = first.querySelector('.pagedjs_sheet');
    const area = first.querySelector('.pagedjs_area');
    const s = sheet.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    return {
      pages: pages.length,
      sheetWidth: s.width,
      sheetHeight: s.height,
      left: a.left - s.left,
      top: a.top - s.top,
      folio: pages.map((p) => {
        const box = p.querySelector('.pagedjs_margin-bottom-center');
        return box ? box.classList.contains('hasContent') : false;
      }),
    };
  })()`);

  // ── The paper the document named, not the one preferred ───────────
  closeTo(measured.sheetWidth, LETTER_WIDTH_MM, "the sheet width");
  closeTo(measured.sheetHeight, LETTER_HEIGHT_MM, "the sheet height");

  // ── The margin the document named, not the one preferred ──────────
  closeTo(measured.left, DOC_MARGIN_MM, "the left margin");
  closeTo(measured.top, DOC_MARGIN_MM, "the top margin");

  // ── And the narrowest margin a document may ask for still numbers ─
  // Which is the reason that floor is where it is rather than at zero.
  assert(
    measured.folio.length > 1 && measured.folio.every(Boolean),
    `every page should carry its number at ${DOC_MARGIN_MM} mm, ` +
      `got ${JSON.stringify(measured.folio)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `PASS: document-page.spec — the front-matter's Letter and ${DOC_MARGIN_MM} mm ` +
      `beat a preference set to A4 and 35 mm across ${measured.pages} sheets, ` +
      "and every one of them is numbered",
  );
} finally {
  /*
   * Put the stored preferences back whatever happened.
   *
   * The specs share one browser and one localStorage, and this one writes a
   * paper and a margin that no other spec expects. Cleaning up only on the
   * happy path is how one red spec becomes several.
   */
  try {
    await page.evaluate(`localStorage.removeItem(${JSON.stringify(PREFS_KEY)}); true`);
  } catch {
    // The page may already be gone; there is nothing further to do here.
  }
  for (const id of [configId, prefsId, shimId]) {
    if (id) await page.removeInitScript(id).catch(() => {});
  }
  page.close();
}
