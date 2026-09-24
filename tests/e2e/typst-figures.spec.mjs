/**
 * E2E spec — a figure a Typst document embeds as SVG reaches the preview.
 *
 * Typst writes such a figure as an `<image>` whose source is the SVG itself,
 * base64-encoded, and the preview's sanitizer used to strip that source:
 * the figure was left as an empty box. This compiles a document with one,
 * through the real renderer, and checks that the preview's image still has
 * its source and that the SVG in it decodes whole.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

// A 40 x 20 figure, which is what the decoded image has to measure.
const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>';
const DOCUMENT = [
  "#set page(width: 10cm, height: auto)",
  "= A figure",
  `#image(bytes(${JSON.stringify(FIGURE)}), format: "svg", width: 4cm)`,
  "",
].join("\n");
// A path ending in .typ is what makes the shim's document a Typst one.
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT, docPath: "/e2e/figure.typ" })};`;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.typst-svg-wrapper svg')", {
    timeout: 45000,
    message: "the Typst document should compile to SVG",
  });

  const figure = await page.evaluate(`(async () => {
    const image = document.querySelector('.typst-svg-wrapper image');
    if (!image) return { error: 'no image in the preview' };
    const source = image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!source) return { error: 'the image has no source', markup: image.outerHTML.slice(0, 200) };
    const decoded = new Image();
    decoded.src = source;
    try {
      await decoded.decode();
    } catch (error) {
      return { error: 'the source does not decode: ' + error, start: source.slice(0, 40) };
    }
    return { start: source.slice(0, 26), width: decoded.naturalWidth, height: decoded.naturalHeight };
  })()`);
  assert(!figure.error, `the figure did not reach the preview: ${JSON.stringify(figure)}`);
  assert(
    figure.start === "data:image/svg+xml;base64," && figure.width === 40 && figure.height === 20,
    `the figure in the preview is not the one embedded: ${JSON.stringify(figure)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log("typst-figures.spec ok — the embedded SVG figure reaches the preview whole, 40 x 20");
} finally {
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
