/**
 * E2E spec — a figure's caption prints as solid as the text around it.
 *
 * The Web view sets captions a little lighter (preview/markdown.css), and
 * that rule cannot leave the Document view out, so it reached the page too:
 * the printed caption was text at 85 % opacity, drawn in the PDF with a fill
 * alpha of .85. This lays a figure out on the page and checks the caption
 * there, and then what the printer makes of it.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
// One black pixel: the image is not the subject, its caption is.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DOCUMENT = ["# A figure", "", `![A dot](${PNG} "A dot on the page")`, ""].join("\n");
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ docView: true, wrap: true }));
    return true;
  })()`);
  await page.reload();
  await page.waitFor("!!document.querySelector('.paged-view .pagedjs_page figcaption')", {
    timeout: 30000,
    message: "the figure's caption should reach the page",
  });

  // What the caption is drawn with, all the way up: an ancestor's opacity
  // would fade it just the same.
  const opacity = await page.evaluate(`(() => {
    let product = 1;
    for (let el = document.querySelector('.paged-view .pagedjs_page figcaption'); el; el = el.parentElement) {
      product *= Number(getComputedStyle(el).opacity);
    }
    return product;
  })()`);
  assert(opacity === 1, `the caption on the page is drawn at opacity ${opacity}`);

  // And in the PDF: every fill and stroke alpha the printer wrote.
  const res = await page.send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
  const pdf = Buffer.from(res.result.data, "base64").toString("latin1");
  const alphas = [...new Set(pdf.match(/\/(?:ca|CA)\s*[0-9.]+/g) || [])];
  const faded = alphas.filter((alpha) => Number(alpha.replace(/^\/(?:ca|CA)\s*/, "")) < 1);
  assert(faded.length === 0, `the printed page draws something faded: ${faded.join(", ")}`);

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log("figure-captions.spec ok — the caption is solid on the page and in the PDF");
} finally {
  await page
    .evaluate(`(() => { localStorage.removeItem(${JSON.stringify(PREFERENCES_KEY)}); return true; })()`)
    .catch(() => {});
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
