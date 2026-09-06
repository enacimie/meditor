/**
 * E2E spec — the table of contents gets the page numbers right.
 *
 * `[TOC]` renders a list of links in either view, and a unit test can check
 * that much. What it cannot check is the half that makes the feature worth
 * having: in the paginated view each entry is followed by the page its heading
 * ended up on, and that number does not exist until paged.js has laid the
 * document out. `target-counter` is resolved by paged.js itself, so nothing
 * short of a real pagination says whether it worked.
 *
 * The document arrives through the shim rather than being typed. Typing it
 * would mean replacing what is in the editor, and a DOM selection does not
 * reach CodeMirror — `drawSelection` keeps its own — so the text lands after
 * the sample instead of over it, and the assertions then measure both
 * documents at once. The shim's document is its own, so there is also nothing
 * in the shared session to restore.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/**
 * Three chapters, each tall enough to take a page of its own.
 *
 * `Array.from` and not `Array(20)`: the latter is sparse, `flatMap` skips
 * holes, and the filler silently comes out empty — which looks exactly like a
 * pagination that decided everything fits on one page.
 */
const FILLER = "Relleno para empujar el capítulo siguiente a su propia página.";
const DOCUMENT = [
  "[TOC]",
  "",
  "# Primero",
  "",
  ...Array.from({ length: 45 }).flatMap(() => [FILLER, ""]),
  "# Segundo",
  "",
  ...Array.from({ length: 45 }).flatMap(() => [FILLER, ""]),
  "# Tercero",
  "",
  FILLER,
  "",
].join("\n");

const page = await connect(CDP_PORT);

const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({
  docContent: DOCUMENT,
})};`;

let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The paginated view is the one with page numbers ──────────────────
  // Wait for this document's own table of contents, and for the pagination
  // to have settled on more than one page — the numbers mean nothing before
  // paged.js has decided where the headings fall.
  await page.waitFor(
    `(() => {
      const toc = document.querySelector('.paged-view .markdown-toc');
      const links = toc ? toc.querySelectorAll('a') : [];
      return links.length === 3
        && links[0].textContent === 'Primero'
        && document.querySelectorAll('.paged-view .pagedjs_page').length >= 3;
    })()`,
    { timeout: 40000, message: "the three chapters should paginate with a table of contents" },
  );

  // ── Each entry shows the page its heading really landed on ───────────
  // The page number lives in `a::after`, which is not in the DOM, so it is
  // read back out of the computed style — and compared against where the
  // heading itself ended up, not against a number written into this spec.
  const entries = await page.read(`(() => {
    const pages = [...document.querySelectorAll('.paged-view .pagedjs_page')];
    const pageOf = (id) => {
      const heading = document.querySelector('.paged-view [id="' + id + '"]');
      if (!heading) return null;
      const sheet = heading.closest('.pagedjs_page');
      return sheet ? pages.indexOf(sheet) + 1 : null;
    };
    return [...document.querySelectorAll('.paged-view .markdown-toc a')].map((a) => {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      return {
        text: a.textContent,
        shown: getComputedStyle(a, '::after').content,
        counter: a.getAttribute('data-target-counter') || null,
        heading: pageOf(id),
      };
    });
  })()`);

  assert(entries.length === 3, `three entries expected, got ${entries.length}`);
  assert(
    entries.every((e) => e.heading !== null),
    `every entry should point at a heading on a real page, got ${JSON.stringify(entries)}`,
  );
  // The headings must not all be on page 1, or the assertion below proves
  // nothing about the numbers being per-entry.
  const spread = new Set(entries.map((e) => e.heading));
  assert(
    spread.size >= 2,
    `the chapters should be spread over pages, got ${JSON.stringify([...spread])}`,
  );

  // paged.js rewrites `target-counter(...)` into a counter of its own, so the
  // computed content is a `counter(...)` expression rather than a digit. What
  // proves the number is right is the rule it generated for this link.
  const resolved = await page.read(`(() => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch { return []; }
    });
    return [...document.querySelectorAll('.paged-view .markdown-toc a')].map((a) => {
      const name = getComputedStyle(a, '::after').content.match(/target-counter-[0-9a-f-]+/);
      if (!name) return null;
      const attr = [...a.attributes].map((x) => x.name).find((n) => n.startsWith('data-target-counter'));
      const value = attr ? a.getAttribute(attr) : null;
      const rule = rules.find((r) => r.includes(name[0]) && value && r.includes(value));
      // Split rather than match: inside a template literal a backslash-d is
      // just a d, so a regex written here would quietly capture the letter
      // out of data-... instead of the number.
      if (!rule) return null;
      const tail = rule.split(name[0] + ' ')[1];
      const digits = tail ? parseInt(tail, 10) : NaN;
      return Number.isInteger(digits) ? digits : null;
    });
  })()`);

  assert(
    resolved.every((n) => Number.isInteger(n)),
    `paged.js should have resolved a page number for every entry, got ${JSON.stringify(resolved)}`,
  );
  const expected = entries.map((e) => e.heading);
  assert(
    JSON.stringify(resolved) === JSON.stringify(expected),
    `the numbers shown should be the pages the headings are on: shown ${JSON.stringify(resolved)}, actual ${JSON.stringify(expected)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while paginating the toc: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    `PASS: toc.spec — three entries numbered ${JSON.stringify(resolved)}, ` +
      "matching the pages their headings landed on",
  );
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
