/**
 * E2E spec — the bookmarks the application hands its backend are the ones
 * Chrome writes itself.
 *
 * Where no engine writes an outline — WebKitGTK never does, and WebView2's
 * `PrintToPdf` does not — `export_pdf` adds one after printing
 * (`pdf_outline.rs`), from the headings the Document view hands it: each
 * with its level, its text, its page, and how far down that page it starts.
 * Chrome writes an outline of its own from the same pages, which makes it the
 * reference: the same headings in the same order, each on the same page and
 * at the same height, give a reader on Linux the bookmarks a reader on
 * Windows has.
 *
 * So this exports through the shim, which records what the backend is
 * handed, prints the page the way Chrome prints it, and compares the two.
 * The Web view has no pages, and hands none.
 *
 * pdf-outline.spec's document: a title, a table of contents, and three
 * chapters over several pages, one heading two levels below the one before.
 */
import { connect, assert } from "./cdp.mjs";
import { bookmarkTargets } from "./printed-pdf.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

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

/**
 * How far Chrome's height for a heading may be from the one the frontend
 * measured. They are not the same point: Chrome points at the heading's text,
 * the frontend at the top of its box, measured 4 to 7 pt above. A wrong page
 * or an upside-down height is hundreds of points out.
 */
const TOLERANCE_PT = 12;

const page = await connect(CDP_PORT);

/** Press Ctrl+E, or Cmd+E on a Mac, and hand back what `export_pdf` was given. */
async function exportPdf() {
  const count = "window.__meditorInvokes.filter((call) => call.cmd === 'export_pdf').length";
  const before = await page.evaluate(count);
  const modifiers = process.platform === "darwin" ? 4 : 2;
  for (const type of ["keyDown", "keyUp"]) {
    await page.send("Input.dispatchKeyEvent", {
      type,
      modifiers,
      key: "e",
      code: "KeyE",
      windowsVirtualKeyCode: 69,
      nativeVirtualKeyCode: 69,
    });
  }
  await page.waitFor(`${count} > ${before}`, {
    timeout: 10000,
    message: "Ctrl+E should export to PDF",
  });
  return page.evaluate(
    "JSON.parse(JSON.stringify(window.__meditorInvokes.filter((call) => call.cmd === 'export_pdf').at(-1).args))",
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

  // Paginated, with its contents, and settled: three polls reading the same.
  await page.evaluate("window.__bookmarksSpecSeen = [], true");
  await page.waitFor(
    `(() => {
      const toc = document.querySelector('.paged-view .markdown-toc');
      const links = toc ? toc.querySelectorAll('a').length : 0;
      const pages = document.querySelectorAll('.paged-view .pagedjs_page').length;
      const seen = window.__bookmarksSpecSeen;
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

  // ── What the Document view hands the backend ─────────────────────────
  const sent = (await exportPdf()).outline;
  assert(
    Array.isArray(sent) && sent.length > 0,
    `the Document view should hand the backend its headings, got ${JSON.stringify(sent)}`,
  );
  const expected = [
    [1, "Informe de prueba"],
    [1, "Primero"],
    [2, "Uno punto uno"],
    [1, "Segundo"],
    [3, "Detalle"],
    [1, "Tercero"],
  ];
  assert(
    JSON.stringify(sent.map((heading) => [heading.level, heading.title])) === JSON.stringify(expected),
    `each heading once, at its own level, the title first: ${JSON.stringify(sent)}`,
  );

  // ── Against the outline Chrome writes from the same pages ────────────
  const printed = await page.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
  });
  const chrome = bookmarkTargets(Buffer.from(printed.result.data, "base64"));
  assert(
    chrome.height > 0 && JSON.stringify(chrome.items.map((b) => b.title)) === JSON.stringify(sent.map((h) => h.title)),
    `the same headings as Chrome's own bookmarks, in the same order: ${JSON.stringify(chrome)}`,
  );
  const compared = sent.map((heading, index) => ({
    title: heading.title,
    page: [heading.page, chrome.items[index].page],
    height: [
      Math.round(chrome.height * (1 - heading.top) * 10) / 10,
      Math.round(chrome.items[index].y * 10) / 10,
    ],
  }));
  const misplaced = compared.filter(
    ({ page: [ours, theirs], height: [mine, chromes] }) =>
      ours !== theirs || !(Math.abs(mine - chromes) <= TOLERANCE_PT),
  );
  assert(
    misplaced.length === 0,
    `each heading should be where Chrome points: its page, and its height within ${TOLERANCE_PT} pt; ` +
      `these are not ([ours, Chrome's]): ${JSON.stringify(misplaced)}`,
  );

  // ── The Web view has no pages to name ────────────────────────────────
  await page.evaluate("document.querySelector('.pane-view-label').closest('button').click(), true");
  await page.waitFor(
    "document.querySelectorAll('.preview-scroll > .markdown-body:not(.preview-source) .markdown-toc a').length === 5",
    { timeout: 20000, message: "the Web view should draw the document" },
  );
  const fromWeb = (await exportPdf()).outline;
  assert(
    fromWeb === null || fromWeb === undefined,
    `the Web view should hand no bookmarks, got ${JSON.stringify(fromWeb)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while exporting: ${JSON.stringify(page.consoleErrors)}`,
  );

  const worst = Math.max(...compared.map(({ height: [mine, chromes] }) => Math.abs(mine - chromes)));
  console.log(
    `PASS: pdf-bookmarks.spec — ${sent.length} headings handed to the backend, each on Chrome's page ` +
      `and within ${worst.toFixed(1)} pt of its height; none from the Web view`,
  );
} finally {
  if (shimId) await page.removeInitScript(shimId);
  if (configId) await page.removeInitScript(configId);
  await page.close();
}
