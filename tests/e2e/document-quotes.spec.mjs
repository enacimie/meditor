/**
 * E2E spec — French quotation marks, as drawn on the page.
 *
 * The renderer's output is checked by documentQuotes.test.ts. What only a
 * browser can say is how the narrow no-break space inside « » is drawn:
 * Latin Modern, the document's font, has no glyph for U+202F, so the
 * browser takes it from another font, and which font that is differs from
 * one system to the next. It must still come out as a space narrower than
 * the word space, and not as nothing.
 *
 * On the Document view's pages, where the text is set in Latin Modern.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const DOCUMENT = ["---", "lang: fr", "---", "", 'Il a dit "bonjour" hier soir.', ""].join("\n");
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor(
    "[...document.querySelectorAll('.paged-view .pagedjs_page p')].some((p) => p.textContent.includes('bonjour'))",
    { timeout: 30000, message: "the paragraph should reach the pages" },
  );

  const measured = await page.evaluate(`(async () => {
    await document.fonts.ready;
    const p = [...document.querySelectorAll('.paged-view .pagedjs_page p')]
      .find((el) => el.textContent.includes('bonjour'));
    const text = [...p.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes('bonjour'));
    const width = (at) => {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      return range.getBoundingClientRect().width;
    };
    const s = text.textContent;
    return {
      text: s,
      narrow: [...s].filter((c) => c === '\\u202F').length,
      narrowWidth: s.includes('\\u202F') ? width(s.indexOf('\\u202F')) : null,
      spaceWidth: width(s.indexOf(' ')),
    };
  })()`);

  assert(
    measured.text === "Il a dit «\u202Fbonjour\u202F» hier soir.",
    `the paragraph should read with French marks and narrow spaces: ${JSON.stringify(measured.text)}`,
  );
  assert(
    measured.narrowWidth > 0 && measured.narrowWidth < measured.spaceWidth,
    `the narrow space should be drawn, narrower than a word space: ${JSON.stringify(measured)}`,
  );

  console.log(
    `PASS: document-quotes.spec — « bonjour » with its narrow spaces drawn ${measured.narrowWidth.toFixed(2)} px wide, against ${measured.spaceWidth.toFixed(2)} px for a word space`,
  );
} finally {
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
