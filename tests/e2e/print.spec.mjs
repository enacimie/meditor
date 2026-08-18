/**
 * E2E spec — what reaches the printed page.
 *
 * `export_pdf` prints this very webview, so the PDF is whatever the @media
 * print stylesheet leaves visible. That makes print a real output of the app
 * and not just a stylesheet detail: a rule that hides a pane on screen and is
 * not scoped to `screen` silently empties the export.
 *
 * Chrome's media emulation is the only way to see this from a test — jsdom
 * applies no stylesheets, and nothing in the app's own DOM changes when the
 * media type does.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);

/** Computed display of the two panes, in DOM order: editor, preview. */
const panes = () =>
  page.evaluate(`(() => {
    const p = [...document.querySelectorAll('.split > .pane')];
    return {
      count: p.length,
      display: p.map((el) => getComputedStyle(el).display),
      appClass: document.querySelector('.app').className,
    };
  })()`);

/** Interface controls that must not end up inside the document. */
const CHROME = [".topbar", ".tabbar", ".pane-header", ".statusbar", ".zen-exit"];

const visibleChrome = () =>
  page.evaluate(`(() => ${JSON.stringify(CHROME)}
    .map((sel) => [sel, document.querySelector(sel)])
    .filter(([, el]) => el && getComputedStyle(el).display !== 'none')
    .map(([sel]) => sel))()`);

const setMedia = (media) => page.send("Emulation.setEmulatedMedia", { media });

try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The baseline: printing shows the preview, not the source ──────
  await setMedia("print");
  const normal = await panes();
  assert(normal.count === 2, `expected two panes, got ${normal.count}`);
  assert(normal.display[0] === "none", "the editor pane should not be printed");
  assert(
    normal.display[1] !== "none",
    `the preview pane is the document and must be printed, got display: ${normal.display[1]}`,
  );

  // The buttons and the word count are the app, not the document.
  const chromeInPrint = await visibleChrome();
  assert(
    chromeInPrint.length === 0,
    `no interface should reach the printed page, got: ${chromeInPrint.join(", ")}`,
  );

  // ── Zen must not change what comes out ───────────────────────────
  // Zen hides the preview on screen. Ctrl+E exports to PDF and works while
  // zen is on, so if that rule reached print media the export would be blank.
  await setMedia("screen");
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',bubbles:true})); true",
  );
  await page.waitFor("document.querySelector('.app').classList.contains('zen')");

  const zenOnScreen = await panes();
  assert(
    zenOnScreen.display[1] === "none",
    "zen is a writing mode: the preview must stay hidden on screen",
  );

  await setMedia("print");
  const zenInPrint = await panes();
  assert(
    zenInPrint.display[1] !== "none",
    `printing from zen must still produce the document, got display: ${zenInPrint.display[1]}`,
  );
  assert(
    zenInPrint.display[0] === "none",
    "the editor pane should not be printed from zen either",
  );
  const zenChrome = await visibleChrome();
  assert(
    zenChrome.length === 0,
    `no interface should reach the printed page from zen either, got: ${zenChrome.join(", ")}`,
  );

  await setMedia("");
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true",
  );
  await page.waitFor("!document.querySelector('.app').classList.contains('zen')");

  /*
   * A heading must not be the last thing on a page, with what it introduces
   * starting on the next one. `break-after: avoid` alone does not manage it —
   * paged.js will not chain it across a run of consecutive headings — so
   * previewRenderer groups each run with its first block into one element.
   */
  await page.waitFor("document.querySelectorAll('.pagedjs_page').length > 0", {
    timeout: 30000,
    interval: 500,
    message: "the paginated view should render",
  });
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__printPages ?? -1;
      window.__printPages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 30000, interval: 500, message: "pagination should settle" },
  );

  const layout = await page.evaluate(`(() => {
    const SEL = 'h1,h2,h3,h4,h5,h6,p,ul,ol,dl,table,pre,blockquote,figure';
    const stranded = [];
    for (const page of document.querySelectorAll('.pagedjs_page')) {
      const area = page.querySelector('.pagedjs_area') || page;
      const blocks = [...area.querySelectorAll(SEL)]
        .filter((el) => el.getBoundingClientRect().height > 0);
      const last = blocks[blocks.length - 1];
      if (last && /^H[1-6]$/.test(last.tagName)) {
        stranded.push((last.innerText || '').replace(/\s+/g, ' ').slice(0, 30));
      }
    }
    const source = document.querySelector('.preview-source');
    const firstBlock = source?.firstElementChild;
    return {
      stranded,
      wrappers: document.querySelectorAll('.keep-with-next').length,
      // If the grouping did not happen, these say why: it only runs when the
      // offscreen source container has layout to measure.
      pages: document.querySelectorAll('.pagedjs_page').length,
      sourceBlocks: source ? source.children.length : -1,
      sourceHeight: source ? source.offsetHeight : -1,
      firstBlockHeight: firstBlock ? firstBlock.offsetHeight : -1,
      docView: !!document.querySelector('.paged-view'),
    };
  })()`);

  assert(
    layout.wrappers > 0,
    "headings should have been grouped with their content: " + JSON.stringify(layout),
  );
  /*
   * One is tolerated, and it is a known paged.js limit rather than slack in the
   * rule: when the group holds something that already carries
   * `break-inside: avoid` of its own — a Mermaid figure, say — paged.js splits
   * the outer group anyway. Measured on this sample: two stranded headings
   * without the grouping, one with it, and the same page count either way.
   */
  assert(
    layout.stranded.length <= 1,
    `headings left alone at the foot of a page: ${JSON.stringify(layout.stranded)}`,
  );

  assert(page.consoleErrors.length === 0, "console errors: " + page.consoleErrors.join(" | "));
  console.log("PASS: print.spec — the preview reaches the printed page, from zen too");
} finally {
  // Leave the browser on screen media for the specs that follow.
  await page.send("Emulation.setEmulatedMedia", { media: "" }).catch(() => {});
  page.close();
}
