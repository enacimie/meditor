/**
 * E2E spec — a table's caption, where the page puts it.
 *
 * tableCaptions.test.ts checks the markup. What only a browser can say is
 * where the caption ends up once laid out: above the rows, as LaTeX sets a
 * table's caption, centred on the table rather than on the column, and in the
 * captions' 9.5 pt whatever the table's own size. In both views, with the
 * interface in Spanish so the label is the translated one.
 *
 * The caption is written after the table, which is the case where drawing it
 * above is the renderer's doing and not the author's.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
const LANGUAGE_KEY = "meditor.language.v1";
const DOCUMENT = [
  "# Resultados",
  "",
  "| Ronda | Tiempo |",
  "| ----- | ------ |",
  "| 1     | 44 s   |",
  "| 2     | 41 s   |",
  "",
  ": Tiempos de las *dos* rondas.",
  "",
].join("\n");
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

const page = await connect(CDP_PORT);

async function reloadWith(docView) {
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ docView: ${docView}, wrap: true }));
    localStorage.setItem(${JSON.stringify(LANGUAGE_KEY)}, "es");
    return true;
  })()`);
  await page.reload();
}

/** Where the caption and the table are, in the view under `container`. */
async function measure(container) {
  await page.waitFor(`!!document.querySelector(${JSON.stringify(`${container} table caption`)})`, {
    timeout: 30000,
    message: `the caption should reach ${container}`,
  });
  return page.evaluate(`(async () => {
    await document.fonts.ready;
    const table = document.querySelector(${JSON.stringify(`${container} table`)});
    const caption = table.querySelector('caption');
    const row = table.querySelector('tr');
    const t = table.getBoundingClientRect();
    const c = caption.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    // The text, not the caption's box: the box is as wide as the table
    // whatever the alignment, so only the text shows whether it is centred.
    const text = document.createRange();
    text.selectNodeContents(caption);
    const w = text.getBoundingClientRect();
    return {
      text: caption.textContent,
      labelWeight: Number(getComputedStyle(caption.querySelector('.table-label')).fontWeight),
      fontSize: getComputedStyle(caption).fontSize,
      captionBottom: c.bottom,
      rowTop: r.top,
      captionCentre: (w.left + w.right) / 2,
      tableCentre: (t.left + t.right) / 2,
      captionWidth: c.width,
    };
  })()`);
}

let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);

  // The Document view: the printed page.
  await reloadWith(true);
  const onPage = await measure(".paged-view .pagedjs_page");
  assert(onPage.captionWidth > 50, `the caption measured should be one on the page: ${JSON.stringify(onPage)}`);
  assert(
    onPage.text === "Tabla 1. Tiempos de las dos rondas.",
    `the caption should be numbered in the interface's language: ${JSON.stringify(onPage.text)}`,
  );
  assert(onPage.labelWeight >= 600, `the label should be bold: ${JSON.stringify(onPage)}`);
  assert(onPage.captionBottom <= onPage.rowTop + 0.5, `the caption should be above the rows: ${JSON.stringify(onPage)}`);
  assert(
    Math.abs(onPage.captionCentre - onPage.tableCentre) <= 1,
    `the caption should be centred on its table: ${JSON.stringify(onPage)}`,
  );
  // 9.5 pt, whatever the table's own 10 pt.
  assert(onPage.fontSize === "12.6667px", `the caption should be set at 9.5 pt: ${onPage.fontSize}`);

  // The Web view: on screen.
  await reloadWith(false);
  const onScreen = await measure(".markdown-body:not(.doc)");
  assert(
    onScreen.text === "Tabla 1. Tiempos de las dos rondas.",
    `the Web view should show the same caption: ${JSON.stringify(onScreen.text)}`,
  );
  assert(onScreen.captionBottom <= onScreen.rowTop + 0.5, `on screen too, above the rows: ${JSON.stringify(onScreen)}`);

  console.log("PASS: table-captions.spec — Tabla 1. above its table, centred on it, at 9.5 pt, and the same in the Web view");
} finally {
  await page
    .evaluate(`(() => {
      localStorage.removeItem(${JSON.stringify(PREFERENCES_KEY)});
      localStorage.removeItem(${JSON.stringify(LANGUAGE_KEY)});
      return true;
    })()`)
    .catch(() => {});
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
