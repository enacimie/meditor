/**
 * E2E spec — a paragraph that opens with a bold number lines up like a list.
 *
 * `**1.** Texto` is not a list to Markdown and cannot be: a marker is `1.`
 * followed by a space, and wrapping it in asterisks makes it emphasis. But it
 * is how people hand-number paragraphs that carry other paragraphs in between
 * — replies in a script, notes between steps — which a real list cannot hold
 * without swallowing them.
 *
 * Those paragraphs used to take prose indentation, and prose leaves the first
 * one flush: the "1." then sat a whole indent to the left of every number
 * under it. markdown.ts tags them and paged.css gives them a list's geometry.
 *
 * It has to be measured in a browser. The rule lives in paged.css, which never
 * reaches the document — paged.js parses it and injects its own copy while it
 * paginates — so nothing short of a real pagination can say where the text
 * actually lands.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

// Long enough to wrap: where the second line starts is half the point.
const LONG = "punto con un texto lo bastante largo como para que ocupe dos líneas y se vea dónde alinean las siguientes.";

const DOC = [
  "## Lista real",
  "",
  `1. Primer ${LONG}`,
  `2. Segundo ${LONG}`,
  "",
  "## Numerados a mano",
  "",
  `**1.** Primer ${LONG}`,
  "",
  "—*Respuesta intercalada.*",
  "",
  `**2.** Segundo ${LONG}`,
  "",
  "## Prosa",
  "",
  "Primer párrafo de prosa, que por convención va a bandera.",
  "",
  "Segundo párrafo de prosa, que sí lleva sangría de primera línea.",
  "",
].join("\n");

const page = await connect(CDP_PORT);

/** Put `text` in the editor, replacing whatever is there. */
const setDocument = (text) =>
  page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    return true;
  })()`);

let sampleDocument = null;

try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor("!!localStorage.getItem('meditor.web.session.v3')", {
    timeout: 20000,
    message: "the app should have written a session to restore later",
  });
  // The app flushes its session on unload, so a document left in the editor
  // reaches the next spec. Keep the sample to put back at the end.
  sampleDocument = await page.evaluate(
    "JSON.parse(localStorage.getItem('meditor.web.session.v3')).docs[0].content",
  );

  await setDocument(DOC);
  await page.waitFor("!!document.querySelector('.paged-view p.numbered-paragraph')", {
    timeout: 30000,
    message: "the hand-numbered paragraphs should reach the paginated view",
  });
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.paged-view .pagedjs_page').length;
      const previous = window.__numberedPages ?? -1;
      window.__numberedPages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 30000, interval: 400, message: "pagination should settle" },
  );

  const m = await page.evaluate(`(() => {
    const host = document.querySelector('.paged-view');
    const lines = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return rects.map((r) => Math.round(r.left));
    };
    const items = [...host.querySelectorAll('ol > li')];
    const numbered = [...host.querySelectorAll('p.numbered-paragraph')];
    const prose = [...host.querySelectorAll('p:not(.numbered-paragraph)')]
      .filter((p) => p.textContent.trim().startsWith('Primer párrafo de prosa') ||
                     p.textContent.trim().startsWith('Segundo párrafo de prosa'));
    return {
      listText: items.length ? lines(items[0])[0] : null,
      listCount: items.length,
      numberedCount: numbered.length,
      // The bold number sits where a list marker would; the wrapped lines
      // land in the same column as a list item's text.
      marker: numbered.map((p) => Math.round(p.querySelector('strong').getBoundingClientRect().left)),
      wrapped: numbered.map((p) => { const l = lines(p); return l[l.length - 1]; }),
      prose: prose.map((p) => lines(p)[0]),
    };
  })()`);

  assert(m.listCount === 2, `the real list should render two items, found ${m.listCount}`);
  assert(m.numberedCount === 2, `both hand-numbered paragraphs should be tagged, found ${m.numberedCount}`);

  // The bug, in one line: the first number used to sit an indent to the left
  // of the second, because prose leaves the first paragraph flush.
  assert(
    m.marker[0] === m.marker[1],
    `every hand-numbered paragraph should start in the same column, got ${m.marker.join(" and ")}`,
  );

  // And the point of the fix: they line up with a real list, not merely with
  // each other.
  for (const [i, wrapped] of m.wrapped.entries()) {
    assert(
      wrapped === m.listText,
      `the lines under number ${i + 1} should align with a real list's text (${m.listText}), got ${wrapped}`,
    );
  }
  assert(
    m.marker[0] < m.listText,
    `the number should hang to the left of the text, like a list marker (${m.marker[0]} vs ${m.listText})`,
  );

  /*
   * Prose is untouched, and this is the half that makes the rest mean
   * something: aligning everything would also be achieved by dropping the
   * paragraph indent altogether, which is a different — and unwanted — change.
   */
  assert(m.prose.length === 2, `expected two prose paragraphs, found ${m.prose.length}`);
  assert(
    m.prose[0] < m.prose[1],
    `prose should keep its first paragraph flush and indent the next, got ${m.prose.join(" and ")}`,
  );

  console.log(
    `PASS: numbered-paragraph.spec — numbers at ${m.marker[0]}, their lines at ` +
      `${m.wrapped[0]} with a real list's text at ${m.listText}; prose still ` +
      `${m.prose[0]} then ${m.prose[1]}`,
  );
} finally {
  // Hand the next spec the document it expects: closing this page flushes
  // whatever is in the editor into storage.
  if (sampleDocument) {
    await setDocument(sampleDocument);
    await page.waitFor(
      "!document.querySelector('.cm-content').innerText.includes('Numerados a mano')",
      { timeout: 10000, message: "the sample document should be back before closing" },
    );
  }
  page.close();
}
