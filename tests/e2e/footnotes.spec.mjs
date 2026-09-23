/**
 * E2E spec — footnotes at the foot of the page they are called on.
 *
 * markdown-it collects notes into a list at the end of the document, and the
 * Document view used to print them there: a note called on page 1 was read
 * on the last page. pagedFootnotes.ts now lifts each note that can stand in
 * line next to its call, and paged.js moves it to the note area at the foot
 * of that page. Only a real pagination can say where a note lands, so this
 * measures it: every lifted note sits in the note area of its call's page,
 * with the number markdown-it gave it; the note that cannot stand in line
 * (it holds a list) stays at the end with its number; the table of contents
 * still finds its pages; and the Web view keeps the plain list.
 *
 * The document arrives through the shim, like toc.spec's.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
const FILLER = "Relleno para que el documento ocupe varias páginas y cada nota tenga la suya.";
const LONG_NOTE = Array.from({ length: 14 }, () => "Una nota larga que no cabe entera al pie.").join(" ");
const DOCUMENT = [
  "[TOC]",
  "",
  "# Primero",
  "",
  "Un párrafo con una nota.[^p] Y otra vez la misma nota.[^p]",
  "",
  "| Columna |",
  "| ------- |",
  "| Una celda con nota.[^c] |",
  "",
  "> Una cita con nota.[^q]",
  "",
  "- Un elemento de lista con nota.[^l]",
  "",
  "Una nota en línea.^[El texto de la nota en línea.]",
  "",
  ...Array.from({ length: 30 }).flatMap(() => [FILLER, ""]),
  "# Segundo",
  "",
  "Un párrafo en la segunda parte con una nota larga.[^long]",
  "",
  "Y una nota con una lista dentro.[^list]",
  "",
  ...Array.from({ length: 30 }).flatMap(() => [FILLER, ""]),
  "[^p]: La nota del párrafo.",
  "[^c]: La nota de la celda.",
  "[^q]: La nota de la cita.",
  "[^l]: La nota de la lista.",
  `[^long]: ${LONG_NOTE}`,
  "[^list]: Una nota con lista:",
  "",
  "    - uno",
  "    - dos",
  "",
].join("\n");

const page = await connect(CDP_PORT);
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor(
    "document.querySelectorAll('.paged-view .pagedjs_page').length >= 3 && !!document.querySelector('.paged-view .pagedjs_footnote_area .footnote')",
    { timeout: 40000, message: "the document should paginate with its notes at the foot of pages" },
  );
  // Let paged.js finish: the page count settles once the last page is laid out.
  let previous = -1;
  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate("document.querySelectorAll('.paged-view .pagedjs_page').length");
    if (count === previous) break;
    previous = count;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const report = await page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.paged-view .pagedjs_page')];
    const pageOf = (el) => pages.indexOf(el.closest('.pagedjs_page')) + 1;
    const calls = [...document.querySelectorAll('.paged-view sup.footnote-call a')].map((a) => ({
      target: a.getAttribute('href'),
      text: a.textContent,
      page: pageOf(a),
    }));
    const notes = [...document.querySelectorAll('.paged-view .pagedjs_footnote_area .footnote')].map((note) => ({
      id: note.querySelector('.footnote-number')?.id ?? null,
      number: note.querySelector('.footnote-number')?.textContent ?? null,
      text: note.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60),
      page: pageOf(note),
      split: note.hasAttribute('data-split-from'),
    }));
    const endnotes = [...document.querySelectorAll('.paged-view section.footnotes li.footnote-item')].map((li) => ({
      id: li.id,
      value: li.getAttribute('value'),
      text: li.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40),
    }));
    return { pages: pages.length, calls, notes, endnotes };
  })()`);

  const notesById = new Map();
  for (const note of report.notes) {
    if (note.id) notesById.set(note.id, note);
  }
  // Every note but the one holding a list is lifted: p, c, q, l, the inline
  // one, and the long one, numbered 1 to 7 in order of first call.
  const floated = ["fn1", "fn2", "fn3", "fn4", "fn5", "fn6"];
  for (const id of floated) {
    const note = notesById.get(id);
    assert(note, `note ${id} should be at the foot of a page: ${JSON.stringify(report)}`);
    const firstCall = report.calls.find((call) => call.target === `#${id}`);
    assert(firstCall, `note ${id} should still have its call: ${JSON.stringify(report.calls)}`);
    assert(
      note.page === firstCall.page,
      `note ${id} should be on the page of its call (${firstCall.page}), found on ${note.page}`,
    );
    assert(note.number === id.slice(2), `note ${id} should carry its number, got ${note.number}`);
    assert(firstCall.text === id.slice(2), `the call to ${id} should read ${id.slice(2)}, got ${firstCall.text}`);
  }
  const repeated = report.calls.filter((call) => call.target === "#fn1");
  assert(
    repeated.length === 2 && repeated.every((call) => call.text === "1"),
    `a note cited twice should be called "1" both times: ${JSON.stringify(repeated)}`,
  );
  assert(
    report.notes.filter((note) => note.id === "fn1").length === 1,
    "a note cited twice should be printed once",
  );
  assert(
    report.endnotes.length === 1 && report.endnotes[0].id === "fn7" && report.endnotes[0].value === "7",
    `the note with a list should stay at the end, numbered 7: ${JSON.stringify(report.endnotes)}`,
  );

  // Only markdown-it's number shows: paged.js's own call, which it inserts
  // before each note, draws nothing, and the note in the area is a plain block
  // rather than a list item with a counted marker of its own. In the type the
  // note area sets: 9 pt Latin Modern.
  const looks = await page.evaluate(`(() => {
    const calls = [...document.querySelectorAll('.paged-view a[data-footnote-call]')];
    const notes = [...document.querySelectorAll('.paged-view .pagedjs_footnote_area .footnote')];
    return {
      pagedCalls: calls.length,
      pagedCallContent: [...new Set(calls.map((c) => getComputedStyle(c, '::after').content))],
      noteDisplay: [...new Set(notes.map((n) => getComputedStyle(n).display))],
      noteFont: [...new Set(notes.map((n) => getComputedStyle(n).fontSize + ' ' + getComputedStyle(n).fontFamily.split(',')[0]))],
    };
  })()`);
  assert(
    looks.pagedCalls > 0 && looks.pagedCallContent.every((content) => content === "none"),
    `paged.js's own calls should draw nothing: ${JSON.stringify(looks)}`,
  );
  assert(
    looks.noteDisplay.every((display) => display === "block"),
    `notes at the foot should carry no counted marker of their own: ${JSON.stringify(looks)}`,
  );
  assert(
    looks.noteFont.every((font) => font.startsWith("12px") && font.includes("Latin Modern")),
    `notes at the foot should be set in 9 pt Latin Modern: ${JSON.stringify(looks)}`,
  );

  // The table of contents still resolves the pages its headings landed on.
  // paged.js turns target-counter() into a rule of its own per link, so the
  // number is read out of that rule, as toc.spec does.
  const toc = await page.evaluate(`(() => {
    const pages = [...document.querySelectorAll('.paged-view .pagedjs_page')];
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch { return []; }
    });
    return [...document.querySelectorAll('.paged-view .markdown-toc a')].map((a) => {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const heading = document.querySelector('.paged-view [id="' + id + '"]');
      const actual = heading ? pages.indexOf(heading.closest('.pagedjs_page')) + 1 : null;
      const name = getComputedStyle(a, '::after').content.match(/target-counter-[0-9a-f-]+/);
      const attr = [...a.attributes].map((x) => x.name).find((n) => n.startsWith('data-target-counter'));
      const value = attr ? a.getAttribute(attr) : null;
      const rule = name && value ? rules.find((r) => r.includes(name[0]) && r.includes(value)) : null;
      const tail = rule ? rule.split(name[0] + ' ')[1] : null;
      return { id, actual, shown: tail ? parseInt(tail, 10) : null };
    });
  })()`);
  assert(
    toc.length === 2 && toc.every((entry) => Number.isInteger(entry.shown) && entry.shown === entry.actual),
    `the table of contents should still show the pages its headings are on: ${JSON.stringify(toc)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while paginating footnotes: ${JSON.stringify(page.consoleErrors)}`,
  );

  // The Web view has no pages and keeps markdown-it's list.
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ docView: false, wrap: true }));
    return true;
  })()`);
  await page.reload();
  await page.waitFor("!!document.querySelector('.markdown-body:not(.doc) section.footnotes')", {
    timeout: 20000,
    message: "the Web view should keep its list of notes",
  });
  const web = await page.evaluate(`(() => ({
    items: document.querySelectorAll('.markdown-body:not(.doc) section.footnotes li.footnote-item').length,
    lifted: document.querySelectorAll('.markdown-body:not(.doc) span.footnote').length,
  }))()`);
  assert(web.items === 7 && web.lifted === 0, `the Web view should list all 7 notes at the end: ${JSON.stringify(web)}`);

  console.log(
    `PASS: footnotes.spec — ${floated.length} notes at the foot of their call's page over ${report.pages} pages, ` +
      "the note with a list left at the end as 7, and the Web view unchanged",
  );
} finally {
  await page
    .evaluate(`(() => { localStorage.removeItem(${JSON.stringify(PREFERENCES_KEY)}); return true; })()`)
    .catch(() => {});
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
