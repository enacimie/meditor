/**
 * E2E spec — a note that cannot be placed does not freeze the preview.
 *
 * On the Chrome 152 of the CI's Windows and macOS runners, paged.js left the
 * notes 0 px tall, read them as overflowing, and moved them to a new page,
 * then to another, for ever: the preview froze with hundreds of pages behind
 * it. That does not happen here on demand, so this recreates its two halves
 * with a stylesheet of its own.
 *
 * 1. The note area held at 0 px, which is when the notes were squeezed. They
 *    must keep their own height (`.pagedjs_footnote_content` in paged.css), so
 *    the note stays on the page that calls it and no page is added for it.
 * 2. The notes themselves held at 0 px, so they can never fit. paged.js adds a
 *    page for them that keeps none of them, and pagedFootnotePages.ts adds no
 *    more: the page answers, and says in the console why it stopped, once per
 *    pagination.
 *
 * Without the first the note leaves its page; without the second the page
 * stops answering and every evaluation below times out.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const DOCUMENT = [
  "# Una página",
  "",
  "Un párrafo con una nota[^1].",
  "",
  "[^1]: La nota del párrafo.",
  "",
].join("\n");
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;
const STOPPED = "stopped adding pages for footnotes";

const page = await connect(CDP_PORT);
const warnings = [];
page.onMessage((msg) => {
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "warning") {
    warnings.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
});

/** A stylesheet of the spec's own, in place before paged.js runs. */
const styled = (css) =>
  `document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
  });`;

let ids = [];
async function load(css) {
  for (const id of ids) await page.removeInitScript(id);
  ids = [
    await page.addInitScript(CONFIG),
    await page.addInitScript(TAURI_SHIM),
    await page.addInitScript(styled(css)),
  ];
  warnings.length = 0;
  await page.freshPage(BASE_URL);
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.paged-view .pagedjs_page').length;
      const previous = window.__freezeSpecPages ?? -1;
      window.__freezeSpecPages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 30000, interval: 500, message: "the pagination should settle, and the page keep answering" },
  );
  return page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.paged-view .pagedjs_page')];
    const notes = pages[0]?.querySelector('.pagedjs_footnote_inner_content');
    return {
      pages: pages.length,
      noteOnItsPage: !!notes && notes.textContent.includes('La nota del párrafo'),
    };
  })()`);
}

try {
  // 1 — the area squeezed: the note keeps its height and its page.
  const squeezed = await load(".pagedjs_footnote_area { height: 0px !important; }");
  const stoppedWhenSqueezed = warnings.filter((w) => w.includes(STOPPED)).length;
  assert(
    squeezed.pages === 1 && squeezed.noteOnItsPage,
    `with its area squeezed, the note should stay on its page and add none: ${JSON.stringify(squeezed)}`,
  );
  assert(
    stoppedWhenSqueezed === 0,
    `nothing should have had to be stopped, got ${stoppedWhenSqueezed} warning(s): ${JSON.stringify(warnings)}`,
  );

  // 2 — the notes can never fit: one page is added for them, and no more.
  const neverFits = await load(".pagedjs_footnote_content { max-height: 0px !important; }");
  const stopped = warnings.filter((w) => w.includes(STOPPED)).length;
  assert(
    neverFits.pages === 2,
    `a note that can never fit should add one page and stop, got ${JSON.stringify(neverFits)}`,
  );
  // Once per pagination, and the preview paginates more than once on load.
  assert(stopped >= 1, `the stop should say so, got ${JSON.stringify(warnings)}`);

  console.log(
    "PASS: footnote-freeze.spec — a squeezed note area keeps its note on its page, and a note that never fits adds one page and stops",
  );
} finally {
  for (const id of ids) await page.removeInitScript(id).catch(() => {});
  await page.close();
}
