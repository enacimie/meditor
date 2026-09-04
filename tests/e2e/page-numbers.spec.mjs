/**
 * E2E spec — the folio and the running head, on real pages.
 *
 * These are `@page` margin boxes, and `@page` is the one part of `paged.css`
 * that no unit test can reach: the file never becomes a stylesheet in the
 * document, paged.js parses it with its own engine, and only a real
 * pagination says whether the boxes were built, what they were given and
 * where on the sheet they landed. A rule that reads perfectly well in a
 * browser can produce no pages at all here, in silence.
 *
 * The spec only reads the sample document — it types nothing — so it leaves
 * the session exactly as it found it.
 *
 * What is checked here and what is not: the numbering rule reaching every
 * page, the head appearing from the second page onwards, the boxes sitting in
 * the margin below the text rather than over it, and the printed page count
 * matching the paginated one — that last is the guard that the boxes did not
 * push the document onto extra sheets. The digits themselves are read out of
 * the PDF by hand and reported in the pull request: Chrome subsets the font,
 * so the folio arrives as a glyph index rather than a character, and turning
 * it back into "3" needs a PDF library that this dependency-free harness
 * deliberately does not have.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/** Half of the 2.5 cm margin, in CSS pixels — a generous "inside the margin". */
const MARGIN_PX = 47;

const page = await connect(CDP_PORT);

try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor("document.querySelectorAll('.pagedjs_page').length > 1", {
    timeout: 40000,
    message: "the Document view never produced a second page to number",
  });

  const pages = await page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    return pages.map((p, i) => {
      const bottom = p.querySelector('.pagedjs_margin-bottom-center');
      const top = p.querySelector('.pagedjs_margin-top-center');
      const bc = bottom && bottom.querySelector('.pagedjs_margin-content');
      const tc = top && top.querySelector('.pagedjs_margin-content');
      const sheet = p.querySelector('.pagedjs_sheet');
      const area = p.querySelector('.pagedjs_area');
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      };
      return {
        i,
        first: p.classList.contains('pagedjs_first_page'),
        bottomHasContent: bottom ? bottom.classList.contains('hasContent') : false,
        bottomContent: bc ? getComputedStyle(bc, '::after').content : null,
        bottomFont: bottom ? getComputedStyle(bottom).fontFamily : null,
        bottomColor: bottom ? getComputedStyle(bottom).color : null,
        topContent: tc ? getComputedStyle(tc, '::after').content : null,
        title: getComputedStyle(p).getPropertyValue('--pagedjs-string-first-doctitle'),
        bottomRect: r(bottom),
        sheetRect: r(sheet),
        areaRect: r(area),
      };
    });
  })()`);

  assert(pages.length >= 2, `expected at least two pages, got ${pages.length}`);

  // ── Every page carries its number ────────────────────────────────────
  for (const p of pages) {
    assert(
      p.bottomHasContent,
      `page ${p.i + 1} has no folio: paged.js built the box but put nothing in it`,
    );
    assert(
      /counter\(page\)/.test(p.bottomContent ?? ""),
      `page ${p.i + 1} should number itself from the page counter, got ${p.bottomContent}`,
    );
  }

  // The boxes are outside `.markdown-body.doc`, so an unstated font or colour
  // means the interface's — light text on a white sheet in the dark theme.
  const [firstPage] = pages;
  assert(
    /Latin Modern|CMU Serif/.test(firstPage.bottomFont ?? ""),
    `the folio should be set in the document's own face, got ${firstPage.bottomFont}`,
  );
  assert(
    firstPage.bottomColor === "rgb(0, 0, 0)",
    `the folio must be black on the sheet whatever the theme, got ${firstPage.bottomColor}`,
  );

  // ── It sits in the margin, not over the text ─────────────────────────
  for (const p of pages) {
    assert(
      p.bottomRect.top >= p.areaRect.bottom - 1,
      `page ${p.i + 1}: the folio overlaps the text area (folio top ${p.bottomRect.top}, text ends ${p.areaRect.bottom})`,
    );
    assert(
      p.bottomRect.bottom <= p.sheetRect.bottom + 1,
      `page ${p.i + 1}: the folio falls off the sheet`,
    );
    assert(
      p.sheetRect.bottom - p.bottomRect.bottom < MARGIN_PX,
      `page ${p.i + 1}: the folio should sit in the bottom margin, not float above it`,
    );
  }

  // ── The running head starts on the second page ───────────────────────
  assert(
    firstPage.first,
    "the first page should carry paged.js's first-page class",
  );
  assert(
    /none/.test(firstPage.topContent ?? ""),
    `the title is already printed on page 1; it must not also run above it, got ${firstPage.topContent}`,
  );
  for (const p of pages.slice(1)) {
    // Chrome resolves the named string before reporting it, so this is the
    // head as printed rather than the rule that produced it — which is the
    // stronger thing to assert: it proves the heading reached the margin.
    assert(
      (p.topContent ?? "").includes("meditor"),
      `page ${p.i + 1} should run the document's own title above it, got ${p.topContent}`,
    );
    assert(
      p.title.includes("meditor"),
      `page ${p.i + 1} should have taken its head from the sample document's heading, got ${p.title}`,
    );
  }

  // ── Printing: same number of sheets, still A4 ────────────────────────
  // The boxes live in margins the pages already had, so they must not cost a
  // single extra sheet. Comparing the two counts is what would catch it.
  const pdfRes = await page.send("Page.printToPDF", {
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pdf = Buffer.from(pdfRes.result.data, "base64").toString("latin1");
  const printed = (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  assert(
    printed === pages.length,
    `the PDF should have one sheet per paginated page (${pages.length}), got ${printed}`,
  );
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  assert(
    boxes.length > 0 && boxes.every(([w, h]) => Math.abs(w - 595) < 3 && Math.abs(h - 842) < 3),
    `pages should still be A4 (595x842 pt), got ${JSON.stringify(boxes.slice(0, 3))}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors during pagination: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    `PASS: page-numbers.spec — ${pages.length} pages numbered from the bottom margin, ` +
      `head from page 2 (${firstPage.title.replace(/"/g, "").trim()}), ` +
      `printed ${printed} A4 sheets`,
  );
} finally {
  await page.close();
}
