/**
 * E2E spec — ticking a task off from the preview edits the document.
 *
 * The checkbox is a real, enabled `<input>`, so a click ticks it in the DOM
 * whatever the application does. What used to happen next is that the next
 * repaint put it straight back, because nothing wrote the change into the
 * Markdown. Both halves are watched here: the box ticks at once, and it is
 * still ticked after the render that used to undo it, because the source now
 * says so.
 *
 * Only a browser can show that. The click, the source edit and the repaint
 * are three separate things, and a unit test can watch at most one of them.
 *
 * The document comes from the shim rather than being typed into the editor.
 * Typing it meant selecting what was there first, and a DOM Range does not
 * reach CodeMirror — `drawSelection` keeps a selection of its own — so the
 * text landed after the sample instead of over it. Everything below then ran
 * against both documents at once and still passed, because `editorText` reads
 * the rendered lines and CodeMirror only renders the viewport.
 */

import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const DOCUMENT = [
  "# Tasks",
  "",
  "- [ ] first",
  "- [x] second",
  "- [ ] third with [ ] a box in the text",
  "",
].join("\n");

const page = await connect(CDP_PORT);

/**
 * Put the cursor on `line` with a real click, the way a reader would.
 *
 * The assertions below need it somewhere other than the top of the document,
 * so that losing it is visible. A click and not a keystroke: "go to the end"
 * is a different chord on a Mac, and this needs none.
 */
const placeCursor = async (line) => {
  const box = await page.read(`(() => {
    const el = document.querySelectorAll('.cm-content .cm-line')[${line}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) };
  })()`);
  assert(box, `there should be a line ${line} to click`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", {
      type,
      x: box.x,
      y: box.y,
      button: "left",
      clickCount: 1,
    });
  }
};

/**
 * The editor's text, as one string with real newlines.
 *
 * The rendered lines only: CodeMirror renders the viewport, so this is the
 * whole document just while the document is short. It is what made the
 * append-instead-of-replace bug invisible, and it is safe here only because
 * `DOCUMENT` is six lines.
 */
const editorText = () =>
  page.read(`[...document.querySelectorAll('.cm-content .cm-line')]
    .map((l) => l.textContent)
    .join('\\n')`);

/**
 * Undo, on whichever modifier this platform's CodeMirror is listening for.
 *
 * It binds undo to `Mod-z`, which is Cmd on a Mac and Ctrl everywhere else,
 * and works out which from the browser it is running in. Sending ctrlKey
 * unconditionally is how this spec passed on Linux and Windows and failed on
 * the Mac runner, where nothing was undone at all.
 */
const pressUndo = () =>
  page.evaluate(`(() => {
    const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
    const cm = document.querySelector('.cm-content');
    cm.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ',
      ctrlKey: !mac, metaKey: mac,
      bubbles: true, cancelable: true,
    }));
    return true;
  })()`);

/**
 * Which line of the editor the cursor is on.
 *
 * Not its pixel offset: the editor's font finishes loading somewhere in the
 * middle of this spec, every line height changes with it, and comparing two
 * `top` values then measures the font rather than the cursor. Line heights and
 * the cursor move together, so the index they agree on does not.
 */
const cursorLine = () =>
  page.read(`(() => {
    const cursor = document.querySelector('.cm-cursor');
    if (!cursor) return -1;
    const top = parseFloat(cursor.style.top);
    if (Number.isNaN(top)) return -1;
    const lines = [...document.querySelectorAll('.cm-content .cm-line')];
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].offsetTop <= top + 1) index = i;
    }
    return index;
  })()`);

/*
 * Only the two containers the click handler is attached to.
 *
 * `.preview-source` also holds checkboxes — it is the offscreen container the
 * paginator stages into — and clicking one there does nothing at all, which is
 * how the first version of this spec managed to fail against working code.
 */
const VISIBLE_BOXES =
  ".paged-view input.task-list-item-checkbox, " +
  ".markdown-body:not(.doc) input.task-list-item-checkbox";

/**
 * Click the nth task checkbox and report whether it ticked there and then.
 *
 * The read happens in the same evaluation as the click, so it lands before
 * any repaint could have put the box right: it is the feedback the person
 * clicking actually sees, not the state they get a repagination later.
 */
const clickTask = (index) =>
  page.evaluate(`(() => {
    const box = document.querySelectorAll(${JSON.stringify(VISIBLE_BOXES)})[${index}];
    if (!box) return null;
    box.click();
    return { checkedNow: box.checked };
  })()`);

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

  // ── This document, and not the one the other specs leave behind ──────
  // The guard that was missing. When the text was typed in rather than handed
  // over, it landed after the sample and every assertion below still passed;
  // the sample has six task lines of its own, five of them ticked, so even
  // "three or more checkboxes" was true before this document had rendered.
  const opening = await editorText();
  assert(
    opening.startsWith("# Tasks"),
    `the editor should hold this spec's document, got ${JSON.stringify(opening.slice(0, 60))}`,
  );
  assert(
    !opening.includes("A **Markdown** editor"),
    "the sample document should not be here as well",
  );

  await page.waitFor(
    `(() => {
      const boxes = [...document.querySelectorAll(${JSON.stringify(VISIBLE_BOXES)})];
      if (boxes.length !== 3) return false;
      const first = boxes[0].closest('li');
      return !!first && first.textContent.trim().startsWith('first');
    })()`,
    { timeout: 30000, message: "the three tasks of this document should render as checkboxes" },
  );
  const initial = await page.read(
    `[...document.querySelectorAll(${JSON.stringify(VISIBLE_BOXES)})].map((b) => b.checked)`,
  );
  assert(
    JSON.stringify(initial) === "[false,true,false]",
    `the boxes should start as the document says, got ${JSON.stringify(initial)}`,
  );

  // The reader is somewhere down the document, not at the top, so that a
  // cursor sent back to the start is something this can see.
  await placeCursor(4);

  // Where the cursor is before anything is clicked. Read now, not later: a
  // whole-document update sends it to the top, and comparing two readings
  // taken after that would agree with each other and prove nothing.
  const cursorBefore = await cursorLine();
  assert(
    cursorBefore > 0,
    `the cursor should start somewhere down the document to have a place to lose, got ${cursorBefore}`,
  );

  // ── Ticking a pending task writes it into the document ───────────────
  const first = await clickTask(0);
  assert(first, "the first checkbox should be clickable");
  assert(
    first.checkedNow === true,
    "the box should tick the instant it is clicked, not a repagination later",
  );
  await page.waitFor(
    `[...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent === '- [x] first')`,
    { timeout: 10000, message: "clicking the first task should tick it in the source" },
  );

  // ── And the preview comes back showing it ticked ─────────────────────
  await page.waitFor(
    `document.querySelectorAll(${JSON.stringify(VISIBLE_BOXES)})[0]?.checked === true`,
    { timeout: 15000, message: "the repaint should keep the box ticked" },
  );

  // ── Unticking works the same way round ───────────────────────────────
  const second = await clickTask(1);
  assert(second, "the second checkbox should be clickable");
  assert(
    second.checkedNow === false,
    "unticking should clear the box straight away too",
  );
  await page.waitFor(
    `[...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent === '- [ ] second')`,
    { timeout: 10000, message: "clicking a finished task should untick it" },
  );

  // ── The undo history and the cursor survived it ──────────────────────
  // The reason the toggle goes into the live editor instead of handing a new
  // document to React: a whole-document update rebuilds the editor state, and
  // the reader loses everything they could have undone, plus their place in
  // the file. Both are invisible until you look for them.
  await pressUndo();
  await page.waitFor(
    `[...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent === '- [x] second')`,
    { timeout: 10000, message: "undo should put the second task back the way it was" },
  );
  const cursorAfter = await cursorLine();
  assert(
    cursorAfter === cursorBefore,
    `ticking a box should not move the cursor, was on line ${cursorBefore} and is now on ${cursorAfter}`,
  );

  // ── The preview follows the undo, and takes a click after it ─────────
  // Put back with another click rather than a redo: redo is `Mod-Shift-z` on a
  // Mac and `Mod-y` elsewhere, and this is the app's own path anyway, so it
  // tests something instead of just restoring state.
  await page.waitFor(
    `document.querySelectorAll(${JSON.stringify(VISIBLE_BOXES)})[1]?.checked === true`,
    { timeout: 15000, message: "undoing should show the box ticked again in the preview" },
  );
  const again = await clickTask(1);
  assert(again, "the second checkbox should still be clickable after an undo");
  await page.waitFor(
    `[...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent === '- [ ] second')`,
    { timeout: 10000, message: "clicking after an undo should untick it again" },
  );

  // ── Nothing else in the document moved ───────────────────────────────
  const text = await editorText();
  assert(
    text.includes("- [ ] third with [ ] a box in the text"),
    `the untouched line should be untouched, got ${JSON.stringify(text)}`,
  );
  assert(
    text.startsWith("# Tasks"),
    `the heading should still be there, got ${JSON.stringify(text.slice(0, 40))}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while ticking tasks: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    "PASS: task-list.spec — a click ticks the task in the source and survives the repaint, " +
      "undo and the cursor survive it, and a second box further along the line is left alone",
  );
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
