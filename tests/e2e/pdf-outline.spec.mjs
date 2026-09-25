/**
 * E2E spec — the headings become the PDF's bookmarks, each once.
 *
 * On Windows `export_pdf` prints through the DevTools protocol's
 * `Page.printToPDF`, asking for an outline, and Chromium builds it from every
 * heading it finds in the printed page. The Document view keeps more than one
 * copy of the document in that page: the paginated one the reader sees, and
 * the measuring copy paged.js lays out from, parked off-screen. Were any copy
 * but the pages to reach the outline, every bookmark would come twice.
 *
 * So this prints the real application, the way Chrome prints it — WebView2 is
 * the same engine — and reads the bookmarks back. The Rust harness in
 * `paper/webview2_print_contents_tests.rs` shows that WebView2 writes an
 * outline for paged.js's shape of page; this shows that the application's
 * page is that shape.
 *
 * And that every bookmark and every link of the contents leads somewhere, in
 * either view. A destination is named after an id, and the measuring copy
 * carried every heading's id ahead of the pages: the names went undefined,
 * and each click in the PDF went nowhere.
 *
 * The document arrives through the shim rather than being typed, as in
 * toc.spec, and for the same reasons.
 */
import { connect, assert } from "./cdp.mjs";
import { linkCount, namedDestinations, outlineOf } from "./printed-pdf.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/**
 * A title, a table of contents, and three chapters over several pages, with
 * a heading two levels down that skips the one between.
 *
 * `Array.from` and not `Array(n)`: the latter is sparse, `flatMap` skips
 * holes, and the filler would silently come out empty.
 */
const FILLER = "Relleno para empujar el capítulo siguiente a su propia página.";
const filler = (count) => Array.from({ length: count }).flatMap(() => [FILLER, ""]);
const DOCUMENT = [
  "---",
  "title: Informe de prueba",
  "---",
  "",
  "[TOC]",
  "",
  "# Primero",
  "",
  ...filler(20),
  "## Uno punto uno",
  "",
  ...filler(25),
  "# Segundo",
  "",
  ...filler(20),
  "### Detalle",
  "",
  ...filler(25),
  "# Tercero",
  "",
  FILLER,
  "",
].join("\n");

const WEB = ".preview-scroll > .markdown-body:not(.preview-source)";

const page = await connect(CDP_PORT);

/**
 * Wait until the pagination has settled: the contents' five links are
 * there, there are at least three pages, and three polls running have read
 * the same — paged.js lays the pages out one at a time.
 */
async function settledPages() {
  await page.evaluate("window.__outlineSpecSeen = [], true");
  await page.waitFor(
    `(() => {
      const toc = document.querySelector('.paged-view .markdown-toc');
      const links = toc ? toc.querySelectorAll('a').length : 0;
      const pages = document.querySelectorAll('.paged-view .pagedjs_page').length;
      const seen = (window.__outlineSpecSeen ??= []);
      seen.push(links + '/' + pages);
      if (seen.length > 3) seen.shift();
      return links === 5 && pages >= 3 && seen.length === 3 && seen.every((s) => s === seen[0]);
    })()`,
    {
      timeout: 40000,
      interval: 500,
      message: "the document should paginate with its table of contents, and settle",
    },
  );
}

/** The page as Chrome prints it, asked for an outline as `export_pdf` asks. */
async function print() {
  const res = await page.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
  });
  return Buffer.from(res.result.data, "base64");
}

/**
 * Every link and bookmark in `pdf` has a destination the PDF defines.
 *
 * Chrome names each destination after the element's id, and the first
 * element with that id is the one it resolves. Were a hidden copy of the
 * document ahead of the printed one, the name would stay undefined and the
 * click would go nowhere — which is what the measuring copy used to do.
 */
function leadsSomewhere(pdf, where) {
  const { referenced, unresolved } = namedDestinations(pdf);
  assert(referenced.length >= 5, `${where}: the links should name their destinations, got ${JSON.stringify(referenced)}`);
  assert(
    unresolved.length === 0,
    `${where}: every link and bookmark should lead somewhere; these lead nowhere: ${JSON.stringify(unresolved)}`,
  );
}

let configId;
let shimId;
try {
  configId = await page.addInitScript(
    `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`,
  );
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  await settledPages();

  const pdf = await print();

  // ── Each heading, once, nested as the document nests it ──────────────
  // The front-matter title is a heading too, and leads. "Detalle" skips a
  // level and still sits under the chapter it belongs to.
  const outline = outlineOf(pdf);
  const expected = [
    [1, "Informe de prueba"],
    [1, "Primero"],
    [2, "Uno punto uno"],
    [1, "Segundo"],
    [2, "Detalle"],
    [1, "Tercero"],
  ];
  assert(
    JSON.stringify(outline) === JSON.stringify(expected),
    `each heading should be one bookmark, nested as in the document; got ${JSON.stringify(outline)}`,
  );

  // ── The contents' links are there, and every one leads somewhere ─────
  const links = linkCount(pdf);
  assert(links >= 5, `the table of contents' five links should be in the PDF, got ${links}`);
  leadsSomewhere(pdf, "the Document view");

  // ── The Web view prints its links whole too ─────────────────────────
  await page.evaluate("document.querySelector('.pane-view-label').closest('button').click(), true");
  await page.waitFor(`document.querySelectorAll('${WEB} .markdown-toc a').length === 5`, {
    timeout: 20000,
    message: "the Web view should draw the document with its contents",
  });
  leadsSomewhere(await print(), "the Web view");

  // ── And the Document view again, with the Web view drawn behind it ───
  // The Web view stays full while hidden: its ids came before the pages'.
  await page.evaluate("document.querySelector('.pane-view-label').closest('button').click(), true");
  await settledPages();
  leadsSomewhere(await print(), "the Document view after the Web view");

  assert(
    page.consoleErrors.length === 0,
    `console errors while paginating: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    `PASS: pdf-outline.spec — ${outline.length} bookmarks, one per heading, and ${links} links, ` +
      "every one leading somewhere in either view",
  );
} finally {
  if (shimId) await page.removeInitScript(shimId);
  if (configId) await page.removeInitScript(configId);
  await page.close();
}
