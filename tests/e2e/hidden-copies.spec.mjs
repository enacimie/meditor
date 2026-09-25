/**
 * E2E spec — what the preview keeps out of sight stays out of the page.
 *
 * The Document view measures each render in an offscreen copy of the
 * document before paged.js lays out the pages, and the Web view keeps its
 * last render while the Document view shows. Hidden is not gone: an id in
 * either came before the pages' own, and a browser resolves an id to the
 * first element that has it. The contents' links led nowhere in the PDF,
 * which pdf-outline.spec reads back, and a diagram's arrows came out without
 * their heads: Mermaid points each arrow at a `<marker>` by id, and a light
 * diagram is one drawing, cached, wherever it appears — so the pages' arrows
 * took their heads from a copy nobody could see.
 *
 * So this reads, in each view and after each switch, which element each
 * arrow's marker resolves to, and asks that it be the diagram's own. Then
 * that setting the Web view aside costs it nothing: back, it shows at once,
 * where it was scrolled to. And that a render given up half-way, by a switch
 * to the Web view, does not leave its copy behind.
 *
 * Light theme throughout: the dark Web view draws diagrams of its own, with
 * ids of their own, and would pass for the wrong reason.
 */
import { connect, assert, sleep } from "./cdp.mjs";
import { namedDestinations } from "./printed-pdf.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";

/** A diagram with an arrow, and enough text after it for several pages. */
const FILLER = "Relleno para que el documento ocupe varias páginas.";
const filler = (count) => Array.from({ length: count }).flatMap(() => [FILLER, ""]);
const DOCUMENT = [
  "[TOC]",
  "",
  "# Primero",
  "",
  "```mermaid",
  "graph LR",
  "  A[Inicio] --> B[Fin]",
  "```",
  "",
  ...filler(40),
  "# Segundo",
  "",
  ...filler(40),
  "# Tercero",
  "",
  ...filler(40),
].join("\n");

const WEB = ".preview-scroll > .markdown-body:not(.preview-source)";
const PAGES = ".paged-view";
const TOGGLE = "document.querySelector('.pane-view-label').closest('button').click(), true";

/**
 * Switch to the Web view the moment a render has filled the measuring copy,
 * and so before it can have been serialised and emptied: the render is given
 * up half-way, as it is when someone switches views while a diagram draws.
 */
const SWITCH_MID_RENDER = `(() => {
  const observer = new MutationObserver(() => {
    const source = document.querySelector('.preview-source');
    if (!source || !source.firstChild) return;
    observer.disconnect();
    window.__switchedMidRender = true;
    document.querySelector('.pane-view-label').closest('button').click();
  });
  observer.observe(document, { childList: true, subtree: true });
})();`;

const page = await connect(CDP_PORT);

/** Where each arrow of the diagram in `scope` finds its marker. */
const arrows = (scope) =>
  page.evaluate(`(() => {
    const svg = document.querySelector(${JSON.stringify(scope + " .mermaid svg")});
    if (!svg) return null;
    const ids = [...svg.querySelectorAll('[marker-end], [marker-start]')]
      .flatMap((el) => [el.getAttribute('marker-end'), el.getAttribute('marker-start')])
      .filter((ref) => ref && ref.includes('#'))
      .map((ref) => ref.slice(ref.indexOf('#') + 1).split(')')[0].replace(/["']/g, ''));
    return ids.map((id) => {
      const found = document.getElementById(id);
      return {
        id,
        own: svg.contains(found),
        in: !found ? 'nowhere'
          : found.closest('.preview-source') ? 'the measuring copy'
          : found.closest('.paged-view') ? 'the pages'
          : 'the Web view',
      };
    });
  })()`);

function ownArrows(reading, where) {
  assert(
    Array.isArray(reading) && reading.length > 0,
    `${where}: the diagram should be drawn with arrows that name a marker, got ${JSON.stringify(reading)}`,
  );
  const strays = reading.filter((arrow) => !arrow.own);
  assert(
    strays.length === 0,
    `${where}: every arrow should take its head from its own diagram; these take it from ` +
      JSON.stringify(strays),
  );
}

/** Pages laid out with the diagram on them, and three polls reading the same. */
async function settledPages() {
  await page.evaluate("window.__hiddenCopiesSeen = [], true");
  await page.waitFor(
    `(() => {
      const pages = document.querySelectorAll('${PAGES} .pagedjs_page').length;
      const drawn = !!document.querySelector('${PAGES} .pagedjs_page .mermaid svg');
      const seen = (window.__hiddenCopiesSeen ??= []);
      seen.push(pages + '/' + drawn);
      if (seen.length > 3) seen.shift();
      return pages >= 3 && drawn && seen.length === 3 && seen.every((s) => s === seen[0]);
    })()`,
    { timeout: 40000, interval: 500, message: "the document should paginate with its diagram, and settle" },
  );
}

const webDrawn = (message) =>
  page.waitFor(`!!document.querySelector('${WEB} .mermaid svg')`, { timeout: 20000, message });

let configId;
let shimId;
let midRenderId;
try {
  configId = await page.addInitScript(
    `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`,
  );
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ theme: 'light', docView: true, wrap: true })), true`,
  );
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The arrows are the diagram's own, in each view and after each switch ─
  await settledPages();
  ownArrows(await arrows(PAGES), "the Document view");

  await page.evaluate(TOGGLE);
  await webDrawn("the Web view should draw the diagram");
  ownArrows(await arrows(WEB), "the Web view, after the Document view");

  await page.evaluate(TOGGLE);
  await settledPages();
  ownArrows(await arrows(PAGES), "the Document view, after the Web view");

  // ── Set aside, the Web view comes back as it was left ────────────────
  // Every frame from the switch on is recorded: the view must never show
  // empty, and must not have lost its place, which an empty view does as the
  // scroll collapses to the top.
  const parked = await page.evaluate(
    "(() => { const s = document.querySelector('.preview-scroll'); s.scrollTop = 1500; return Math.round(s.scrollTop); })()",
  );
  assert(parked === 1500, `the Document view should be long enough to scroll to 1500 px, got ${parked}`);
  await page.evaluate(`(() => {
    const web = document.querySelector('${WEB}');
    const scroller = document.querySelector('.preview-scroll');
    const frames = (window.__switchFrames = []);
    const start = performance.now();
    const record = () => {
      frames.push({
        shown: getComputedStyle(web).display !== 'none',
        empty: web.childElementCount === 0,
        top: Math.round(scroller.scrollTop),
      });
      if (performance.now() - start < 1000) requestAnimationFrame(record);
    };
    document.querySelector('.pane-view-label').closest('button').click();
    requestAnimationFrame(record);
    return true;
  })()`);
  await sleep(1500);
  const frames = await page.evaluate("window.__switchFrames");
  const shown = frames.filter((frame) => frame.shown);
  assert(shown.length > 0, `the Web view should have shown after the switch: ${JSON.stringify(frames.slice(0, 5))}`);
  assert(
    shown.every((frame) => !frame.empty),
    `the Web view should come back with what it held, not empty: ${shown.filter((f) => f.empty).length} ` +
      `of ${shown.length} frames showed it empty`,
  );
  assert(
    shown[0].top === parked,
    `the Web view should come back where the preview was scrolled to (${parked} px), not at ${shown[0].top}`,
  );
  await webDrawn("the Web view should draw the diagram again");
  ownArrows(await arrows(WEB), "the Web view, back again");

  // ── A render given up half-way leaves nothing behind ─────────────────
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ theme: 'light', docView: true, wrap: true })), true`,
  );
  midRenderId = await page.addInitScript(SWITCH_MID_RENDER);
  await page.reload();
  await page.waitFor(`document.querySelectorAll('${WEB} .markdown-toc a').length === 3`, {
    timeout: 30000,
    message: "the Web view should draw the document with its contents after the switch",
  });
  const halfway = await page.evaluate(`({
    switched: window.__switchedMidRender === true,
    pages: document.querySelectorAll('${PAGES} .pagedjs_page').length,
  })`);
  assert(
    halfway.switched && halfway.pages === 0,
    `the switch should have come while the Document view was still measuring: ${JSON.stringify(halfway)}`,
  );
  const printed = await page.send("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
  });
  const { referenced, unresolved } = namedDestinations(Buffer.from(printed.result.data, "base64"));
  assert(referenced.length >= 3, `the contents' links should name their destinations, got ${JSON.stringify(referenced)}`);
  assert(
    unresolved.length === 0,
    `after a render given up half-way, every link should still lead somewhere; these lead nowhere: ${JSON.stringify(unresolved)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while switching views: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    "PASS: hidden-copies.spec — arrows keep their heads in either view, the Web view comes back " +
      `where it was left (${shown.length} frames, none empty), and a half-done render leaves nothing behind`,
  );
} finally {
  if (midRenderId) await page.removeInitScript(midRenderId);
  if (shimId) await page.removeInitScript(shimId);
  if (configId) await page.removeInitScript(configId);
  await page.close();
}
