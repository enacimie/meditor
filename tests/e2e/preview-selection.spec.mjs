/**
 * E2E spec — what is selected in the editor is marked in the preview.
 *
 * A click in the preview has long outlined the block it lands on and moved
 * the editor there. This is the other way: a selection in the editor outlines
 * the blocks it covers, with the same outline, and brings them into view only
 * when none of them is on screen. The selection is set the way a drag leaves
 * it, through CodeMirror's own view, so the whole path runs: the editor tells
 * the app, the app tells the preview.
 *
 * Checked in the Web view and, after switching to the Document view with the
 * selection still there, on the paginated pages. And neither mark prints:
 * printing is how a Markdown document becomes a PDF.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const PREFERENCES_KEY = "meditor.preferences.v1";
const FILLER = Array.from({ length: 60 }, (_, n) => [`Filler paragraph ${n + 1}.`, ""]).flat();
const DOCUMENT = [
  "# Selection", //                   0
  "", //                              1
  "First paragraph, near the top.", // 2
  "", //                              3
  "- item one", //                    4
  "- item two", //                    5
  "", //                              6
  "| a | b |", //                     7
  "| - | - |", //                     8
  "| 1 | 2 |", //                     9
  "", //                              10
  ...FILLER, //                       11 to 130
  "Last paragraph, far below.", //    131
  "",
].join("\n");
const LAST = 131;
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;

/** The Web view's container: the preview's own, not a page's wrapper of the same class. */
const WEB = ".preview-scroll > .markdown-body:not(.preview-source)";

/** Whether the first block the selection marked is within the preview's window. */
const MARK_IN_VIEW = `(() => {
  const block = document.querySelector('.sync-selected');
  const scroller = document.querySelector('.preview-scroll');
  if (!block || !scroller) return false;
  const box = block.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  return box.bottom > view.top && box.top < view.bottom;
})()`;

const page = await connect(CDP_PORT);

/** Select from (line, column) to (line, column), zero-based, as a drag would. */
const select = (fromLine, fromColumn, toLine, toColumn) =>
  page.evaluate(`(() => {
    const view = document.querySelector('.cm-content').cmTile.root.view;
    const doc = view.state.doc;
    view.dispatch({ selection: {
      anchor: doc.line(${fromLine + 1}).from + ${fromColumn},
      head: doc.line(${toLine + 1}).from + ${toColumn},
    } });
    return true;
  })()`);

/** The marks in a view: what the selection marked, and what a click did. */
const marks = (container) =>
  page.evaluate(`(() => {
    const view = document.querySelector(${JSON.stringify(container)});
    const name = (el) => el.tagName.toLowerCase() + '@' + el.getAttribute('data-line');
    return {
      selected: [...view.querySelectorAll('.sync-selected')].map(name),
      clicked: [...view.querySelectorAll('.sync-marked')].map(name),
    };
  })()`);

const scrollTop = () => page.evaluate("document.querySelector('.preview-scroll').scrollTop");

let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  // The Web view, and a page that is surely the reloaded one before anything
  // is looked at: the old one keeps answering for a moment after reload().
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(PREFERENCES_KEY)}, JSON.stringify({ docView: false, wrap: true }));
    window.__beforeReload = true;
    return true;
  })()`);
  await page.reload();
  await page.waitFor(
    `!window.__beforeReload && !!document.querySelector('.cm-content')?.cmTile &&
      document.querySelectorAll('${WEB} [data-line]').length > 60`,
    { timeout: 20000, message: "the reloaded page should show the editor and draw the document" },
  );

  // Two list items: each is marked, not the list around them.
  await select(4, 2, 5, 4);
  await page.waitFor(`document.querySelectorAll('${WEB} .sync-selected').length > 0`, {
    message: "a selection in the editor should mark the preview",
  });
  let seen = await marks(WEB);
  assert(
    JSON.stringify(seen.selected) === '["li@4","li@5"]',
    `the two list items should be marked, and only them: ${JSON.stringify(seen)}`,
  );

  // A cell of the table's body: its row.
  await select(9, 2, 9, 3);
  seen = await marks(WEB);
  assert(JSON.stringify(seen.selected) === '["tr@9"]', `the row should be marked: ${JSON.stringify(seen)}`);

  // A caret selects nothing, and marks nothing.
  await select(2, 0, 2, 0);
  seen = await marks(WEB);
  assert(seen.selected.length === 0, `a bare caret should leave nothing marked: ${JSON.stringify(seen)}`);

  // Far below what is on screen: the preview comes to it.
  const top = await scrollTop();
  await select(LAST, 0, LAST, 4);
  await page.waitFor(MARK_IN_VIEW, {
    timeout: 5000,
    message: "a selection out of the preview's view should be brought into it",
  });
  // The scroll is smooth: it enters the view before it is done centring.
  await page.waitFor(
    `(() => {
      const now = document.querySelector('.preview-scroll').scrollTop;
      const settled = now === window.__lastScrollTop;
      window.__lastScrollTop = now;
      return settled;
    })()`,
    { timeout: 5000, interval: 250, message: "the preview's scroll should come to rest" },
  );
  const scrolled = await scrollTop();
  assert(scrolled > top + 100, `the preview should have scrolled down to it (from ${top} to ${scrolled})`);

  // Already on screen, but not in the middle of it: the preview stays where
  // it is. (Selecting the paragraph now centred again would prove nothing:
  // centring it a second time moves nothing either.)
  // The last paragraph cannot be centred, the document ends below it; this
  // one sits well off the middle of the window, and whole within it.
  const NEARBY = LAST - 8;
  const nearbyInView = await page.evaluate(`(() => {
    const block = document.querySelector('${WEB} [data-line="${NEARBY}"]');
    const box = block.getBoundingClientRect();
    const view = document.querySelector('.preview-scroll').getBoundingClientRect();
    return box.top > view.top && box.bottom < view.bottom &&
      Math.abs((box.top + box.bottom) / 2 - (view.top + view.bottom) / 2) > 20;
  })()`);
  assert(nearbyInView, "the premise: the paragraph a little above should be on screen, off centre");
  await select(NEARBY, 0, NEARBY, 6);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const still = await scrollTop();
  assert(Math.abs(still - scrolled) < 2, `a selection already in view should not scroll (${scrolled} to ${still})`);

  // A click in the preview marks its block and puts the caret there; the
  // selection's marks go with the selection, the click's stays.
  await page.evaluate(`(() => {
    const target = [...document.querySelectorAll('${WEB} p[data-line]')]
      .find((p) => p.textContent.startsWith('Last paragraph'));
    target.click();
    return true;
  })()`);
  seen = await marks(WEB);
  assert(
    seen.selected.length === 0 && JSON.stringify(seen.clicked) === `["p@${LAST}"]`,
    `a click should leave its own mark and clear the selection's: ${JSON.stringify(seen)}`,
  );

  // Neither mark prints.
  await select(4, 2, 5, 4);
  const outlines = () =>
    page.evaluate(`(() => ({
      selected: getComputedStyle(document.querySelector('${WEB} .sync-selected')).outlineStyle,
      clicked: getComputedStyle(document.querySelector('${WEB} .sync-marked')).outlineStyle,
    }))()`);
  const onScreen = await outlines();
  await page.send("Emulation.setEmulatedMedia", { media: "print" });
  const onPaper = await outlines();
  await page.send("Emulation.setEmulatedMedia", { media: "" });
  assert(
    onScreen.selected === "solid" && onScreen.clicked === "solid",
    `both marks should show on screen: ${JSON.stringify(onScreen)}`,
  );
  assert(
    onPaper.selected === "none" && onPaper.clicked === "none",
    `neither mark should print: ${JSON.stringify(onPaper)}`,
  );

  // Switch to the Document view with the selection still there: the pages
  // are drawn anew, and the marks follow them.
  await page.evaluate("document.querySelector('.pane-view-label').closest('button').click(), true");
  await page.waitFor(
    `document.querySelectorAll('.paged-view .pagedjs_page').length > 1 &&
      document.querySelectorAll('.paged-view .sync-selected').length > 0`,
    { timeout: 40000, interval: 300, message: "the Document view should draw the pages, with the selection marked" },
  );
  seen = await marks(".paged-view");
  assert(
    JSON.stringify(seen.selected) === '["li@4","li@5"]',
    `the Document view should mark the same two items: ${JSON.stringify(seen)}`,
  );

  assert(page.consoleErrors.length === 0, "console errors: " + page.consoleErrors.join(" | "));
  console.log(
    "preview-selection.spec ok — items, a row, nothing for a caret; scrolled to a selection out of view " +
      `(${top} → ${scrolled}) and not for one in view; a click's mark kept; neither printed; ` +
      "the Document view marked the same",
  );
} finally {
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
