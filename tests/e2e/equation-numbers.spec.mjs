/**
 * E2E spec — a numbered equation keeps its number on its own line.
 *
 * `$$ ... $$ (1)` renders as <section class="eqno"><eqn>...</eqn><span>(1)</span>
 * </section>. With no rule for it the number fell onto the line below the
 * formula, at the start of the column. This measures, in both views and in a
 * right-to-left document: the number is on the formula's line, flush with the
 * end of the column, and the formula is still centred on the column.
 *
 * The document arrives through the shim, like toc.spec's; the view and the
 * interface language are preferences, set before each reload and removed at
 * the end.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
const LANGUAGE_KEY = "meditor.language.v1";
const DOCUMENT = [
  "# Energía",
  "",
  "Un párrafo antes de la ecuación, con texto suficiente para ocupar la columna entera.",
  "",
  "$$E = mc^2$$ (1)",
  "",
  "Y otro párrafo después.",
  "",
].join("\n");

const page = await connect(CDP_PORT);
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

/** Reload with the preview in `docView` and the interface in `lang`. */
async function reloadWith(docView, lang) {
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ docView: ${docView}, wrap: true }));
    localStorage.setItem(${JSON.stringify(LANGUAGE_KEY)}, ${JSON.stringify(lang)});
    return true;
  })()`);
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
}

/** Where the section, the formula's glyphs and the number sit, once fonts are in. */
async function measure(container) {
  await page.waitFor(
    `!!document.querySelector(${JSON.stringify(`${container} section.eqno .katex-html .katex-base`)})`,
    { timeout: 30000, message: `the numbered equation should render in ${container}` },
  );
  return page.evaluate(`(async () => {
    await document.fonts.ready;
    const section = document.querySelector(${JSON.stringify(`${container} section.eqno`)});
    const s = section.getBoundingClientRect();
    const bases = [...section.querySelectorAll('.katex-html .katex-base')].map((b) => b.getBoundingClientRect());
    const formula = {
      left: Math.min(...bases.map((r) => r.left)),
      right: Math.max(...bases.map((r) => r.right)),
      top: Math.min(...bases.map((r) => r.top)),
      bottom: Math.max(...bases.map((r) => r.bottom)),
    };
    const numberEl = section.querySelector(':scope > span');
    const range = document.createRange();
    range.selectNodeContents(numberEl);
    const n = range.getBoundingClientRect();
    return {
      text: numberEl.textContent,
      dir: getComputedStyle(section).direction,
      section: { left: s.left, right: s.right },
      formula,
      number: { left: n.left, right: n.right, top: n.top, bottom: n.bottom },
    };
  })()`);
}

function check(label, m) {
  // A hidden copy measures all zeros, and every check below would pass on it.
  assert(
    m.section.right - m.section.left > 200 && m.number.right > m.number.left,
    `${label}: the equation measured should be one on screen: ${JSON.stringify(m)}`,
  );
  assert(m.text === "(1)", `${label}: the number should read (1), got ${JSON.stringify(m.text)}`);
  const numberMiddle = (m.number.top + m.number.bottom) / 2;
  assert(
    numberMiddle >= m.formula.top && numberMiddle <= m.formula.bottom,
    `${label}: the number should sit on the formula's line: ${JSON.stringify(m)}`,
  );
  const gap = m.dir === "rtl" ? m.number.left - m.section.left : m.section.right - m.number.right;
  assert(
    Math.abs(gap) <= 1,
    `${label}: the number should be flush with the end of the column (${m.dir}), off by ${gap.toFixed(1)}px: ${JSON.stringify(m)}`,
  );
  const offCentre =
    (m.formula.left + m.formula.right) / 2 - (m.section.left + m.section.right) / 2;
  assert(
    Math.abs(offCentre) <= 2,
    `${label}: the formula should stay centred on the column, off by ${offCentre.toFixed(1)}px: ${JSON.stringify(m)}`,
  );
}

let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);

  await reloadWith(true, "en");
  const documentView = await measure(".paged-view");
  check("Document view", documentView);

  await reloadWith(false, "en");
  const webView = await measure(".markdown-body:not(.doc)");
  check("Web view", webView);

  await reloadWith(true, "ar");
  const rightToLeft = await measure(".paged-view");
  assert(rightToLeft.dir === "rtl", `the Arabic interface should lay the preview out right to left, got ${rightToLeft.dir}`);
  check("Document view, right to left", rightToLeft);

  console.log("PASS: equation-numbers.spec — the number sits on its formula's line, at the end, in both views and right to left");
} finally {
  await page
    .evaluate(`(() => {
      localStorage.removeItem(${JSON.stringify(PREFERENCES_KEY)});
      localStorage.removeItem(${JSON.stringify(LANGUAGE_KEY)});
      return true;
    })()`)
    .catch(() => {});
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
