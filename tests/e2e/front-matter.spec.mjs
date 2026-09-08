/**
 * E2E spec — a document that names itself keeps that name in the running head.
 *
 * A unit test can say the renderer marks the title block and not the chapters.
 * It cannot say what paged.js then does with the mark, and that is the half
 * that matters: `string-set` is resolved by paged.js against a stylesheet it
 * receives as text and parses itself, and it takes the *last* match on each
 * page — so a chapter heading that answered to the same selector would replace
 * the document's name without anything looking wrong.
 *
 * So this reads the head as printed, on a page that has a chapter heading on
 * it, and checks it still says what the document is called.
 *
 * The document arrives through the shim rather than being typed: a DOM
 * selection does not reach CodeMirror, so typed text lands after the sample
 * instead of over it.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/*
 * Two chapters, each long enough to take a page, under a title of its own.
 * `Array.from` and not `Array(n)`: the latter is sparse, `flatMap` skips the
 * holes, and the filler comes out empty — which looks exactly like a
 * pagination that decided everything fits on one page.
 */
const FILLER = "Relleno para empujar el capítulo siguiente a su propia página.";
const DOCUMENT = [
  "---",
  "title: Informe anual",
  "author: Eduardo Nacimiento",
  "date: 2026-09-08",
  "---",
  "",
  "# Introducción",
  "",
  ...Array.from({ length: 45 }).flatMap(() => [FILLER, ""]),
  "# Conclusiones",
  "",
  FILLER,
  "",
].join("\n");

const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({
  docContent: DOCUMENT,
})};`;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  await page.waitFor("!!document.querySelector('.doc-title-block')", {
    timeout: 20000,
    message: "the title block should reach the preview",
  });

  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.pagedjs_page').length;
      const previous = window.__frontMatterPages ?? -1;
      window.__frontMatterPages = n;
      return n > 1 && n === previous;
    })()`,
    { timeout: 40000, interval: 500, message: "pagination should settle before it is read" },
  );

  const layout = await page.read(`(() => {
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    return {
      pages: pages.length,
      block: (() => {
        const header = document.querySelector('.pagedjs_page .doc-title-block');
        if (!header) return null;
        return {
          onPage: pages.indexOf(header.closest('.pagedjs_page')),
          title: header.querySelector('.doc-title')?.textContent ?? null,
          author: header.querySelector('.doc-author')?.textContent ?? null,
          date: header.querySelector('.doc-date')?.textContent ?? null,
        };
      })(),
      marked: [...document.querySelectorAll('.pagedjs_page .running-head')]
        .map((el) => el.textContent.trim()),
      heads: pages.map((p) => {
        const top = p.querySelector('.pagedjs_margin-top-center .pagedjs_margin-content');
        return {
          printed: top ? getComputedStyle(top, '::after').content : null,
          named: getComputedStyle(p).getPropertyValue('--pagedjs-string-first-doctitle'),
          chapters: [...p.querySelectorAll('h1')].map((h) => h.textContent.trim()),
        };
      }),
    };
  })()`);

  assert(layout.pages > 1, `the fixture should take more than one page, got ${layout.pages}`);
  assert(
    layout.block && layout.block.onPage === 0,
    `the title block belongs at the top of the first page, got ${JSON.stringify(layout.block)}`,
  );
  assert(
    layout.block.title === "Informe anual" &&
      layout.block.author === "Eduardo Nacimiento" &&
      layout.block.date === "2026-09-08",
    `the block should carry all three values, got ${JSON.stringify(layout.block)}`,
  );

  // The mark is on the title and nowhere else. Two marked elements is the
  // failure this spec exists for: paged.js takes the last match on the page.
  assert(
    JSON.stringify(layout.marked) === JSON.stringify(["Informe anual"]),
    `only the title should feed the head, got ${JSON.stringify(layout.marked)}`,
  );

  // The head as printed, on the pages that have one.
  const withChapter = layout.heads
    .slice(1)
    .filter((head) => head.chapters.length > 0);
  assert(
    withChapter.length > 0,
    "the fixture should put a chapter heading on a page after the first, or it proves nothing",
  );
  for (const head of withChapter) {
    assert(
      (head.printed ?? "").includes("Informe anual"),
      `a page carrying ${JSON.stringify(head.chapters)} should still run the document's ` +
        `own name above it, got ${head.printed}`,
    );
    assert(
      !(head.printed ?? "").includes("Conclusiones"),
      `the chapter must not replace the document's name in the head, got ${head.printed}`,
    );
  }

  assert(
    page.consoleErrors.length === 0,
    `console errors while paginating a title block: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    "PASS: front-matter.spec — the title block prints on page one and its title, " +
      "not the chapter, runs above the pages after it",
  );
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
