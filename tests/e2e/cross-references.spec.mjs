/**
 * E2E spec — cross-references land on what they name, on the page and on screen.
 *
 * crossReferences.test.ts checks the markup. What only a browser can say is
 * that the targets survive being laid out: paged.js rebuilds the Document
 * view's pages from the rendered HTML, and a figure, a table or an equation
 * that lost its id there would leave every reference to it pointing at
 * nothing. So each reference's target is looked for in the same view, with
 * the interface in Spanish so the words are the translated ones.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
const LANGUAGE_KEY = "meditor.language.v1";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DOCUMENT = [
  "# Referencias",
  "",
  "Véase @fig:punto, @tbl:tiempos y @eq:energia. @Fig:punto abre la frase, -@fig:punto es el número solo y @fig:nada no existe.",
  "",
  `![Un punto](${PNG} "El punto"){#fig:punto}`,
  "",
  "Table: Tiempos de las dos rondas {#tbl:tiempos}",
  "",
  "| Ronda | Tiempo |",
  "| ----- | ------ |",
  "| 1     | 44 s   |",
  "",
  "$$ E = mc^2 $$ {#eq:energia}",
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

/** The references in the view under `container`, and whether each one's target is there too. */
async function read(container) {
  await page.waitFor(
    `document.querySelectorAll(${JSON.stringify(`${container} a.crossref`)}).length >= 5 && !!document.querySelector(${JSON.stringify(`${container} section.eqno`)})`,
    { timeout: 30000, message: `the references should reach ${container}` },
  );
  return page.evaluate(`(() => {
    const view = document.querySelector(${JSON.stringify(container)});
    const scope = view.closest('.paged-view') ?? view;
    return {
      references: [...view.querySelectorAll('a.crossref')].map((a) => {
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        const target = scope.querySelector('#' + CSS.escape(id));
        return { text: a.textContent, target: target ? target.tagName.toLowerCase() : null };
      }),
      missing: [...view.querySelectorAll('strong.crossref-missing')].map((s) => s.textContent),
      equationNumber: view.querySelector('section.eqno > span')?.textContent ?? null,
      markerLeft: (scope.textContent || '').includes('{#'),
    };
  })()`);
}

const EXPECTED = [
  { text: "fig. 1", target: "figure" },
  { text: "tabla 1", target: "table" },
  { text: "ec. 1", target: "section" },
  { text: "Fig. 1", target: "figure" },
  { text: "1", target: "figure" },
];

let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);

  for (const [name, docView, container] of [
    ["the Document view", true, ".paged-view .pagedjs_page"],
    ["the Web view", false, ".markdown-body:not(.doc)"],
  ]) {
    await reloadWith(docView);
    const seen = await read(container);
    assert(
      JSON.stringify(seen.references) === JSON.stringify(EXPECTED),
      `in ${name}, the references and their targets are ${JSON.stringify(seen.references)}`,
    );
    assert(
      JSON.stringify(seen.missing) === JSON.stringify(["¿fig:nada?"]),
      `in ${name}, the missing label should show as ¿fig:nada?: ${JSON.stringify(seen.missing)}`,
    );
    assert(seen.equationNumber === "(1)", `in ${name}, the labelled equation should be (1): ${seen.equationNumber}`);
    assert(!seen.markerLeft, `in ${name}, a {#…} label is still showing`);
  }

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log("PASS: cross-references.spec — fig. 1, tabla 1, ec. 1, Fig. 1 and 1 land on their targets on the page and on screen; ¿fig:nada? shows");
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
