/**
 * E2E spec — workspace layout modes.
 *
 * The modes are pure CSS, so this has to run in a real browser: jsdom applies
 * no stylesheets and cannot tell whether a pane is actually hidden. What is
 * checked here is exactly that — which panes have a box on screen — plus the
 * parts that only misbehave with real layout: the preview repaginating after
 * being hidden, and the jump back to the source from reading mode.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const press = (page, key, opts = "") =>
  page.evaluate(
    `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ${opts} }));
      return true;
    })()`,
  );

/** What is actually laid out on screen right now. */
const visibility = (page) =>
  page.evaluate(`(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      return !!el && el.offsetParent !== null;
    };
    return {
      editor: box('.cm-editor'),
      preview: box('.preview-scroll'),
      divider: box('.split-divider'),
      classes: document.querySelector('.app')?.className ?? '',
    };
  })()`);

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── Split is the default ──────────────────────────────────────────
  const split = await visibility(page);
  assert(split.editor && split.preview, "split should show both panes");
  assert(split.divider, "split should show the divider");
  assert(!split.classes.includes("layout-"), `split needs no class, got "${split.classes}"`);

  // ── Ctrl+1: editor only ───────────────────────────────────────────
  await press(page, "1", "ctrlKey: true");
  await page.waitFor("document.querySelector('.app').classList.contains('layout-editor')");
  const editorOnly = await visibility(page);
  assert(editorOnly.editor, "editor must stay visible in editor-only mode");
  assert(!editorOnly.preview, "preview must be hidden in editor-only mode");
  assert(!editorOnly.divider, "divider must be hidden when a pane is hidden");

  // The editor should now own the full width, not the split ratio.
  const fullWidth = await page.evaluate(`(() => {
    const pane = document.querySelector('.pane');
    const split = document.querySelector('.split');
    return Math.abs(pane.getBoundingClientRect().width - split.getBoundingClientRect().width) < 2;
  })()`);
  assert(fullWidth, "the visible pane should span the whole workspace");

  // ── Typing while hidden, then coming back, must repaginate ────────
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, '\\n\\n## Added while hidden\\n');
    return true;
  })()`);

  await press(page, "2", "ctrlKey: true");
  await page.waitFor("!document.querySelector('.app').className.includes('layout-')");
  // Wait for the page count to settle: that means pagination finished, not
  // merely that it started.
  await page.waitFor(
    `(() => {
      const n = document.querySelectorAll('.paged-view .pagedjs_page').length;
      const previous = window.__layoutPages ?? -1;
      window.__layoutPages = n;
      return n > 0 && n === previous;
    })()`,
    { timeout: 25000, interval: 400, message: "preview should repaginate after being hidden" },
  );
  const restored = await page.evaluate(`(() => ({
    hasHeading: document.querySelector('.paged-view')?.textContent?.includes('Added while hidden') ?? false,
    error: document.querySelector('.preview-error')?.textContent ?? null,
  }))()`);
  assert(restored.hasHeading, "the preview should show what was typed while it was hidden");
  assert(restored.error === null, `no error banner expected, got: ${restored.error}`);

  // ── Ctrl+3: preview only, and the way back to the source ─────────
  await press(page, "3", "ctrlKey: true");
  await page.waitFor("document.querySelector('.app').classList.contains('layout-preview')");
  const previewOnly = await visibility(page);
  assert(!previewOnly.editor, "editor must be hidden in preview-only mode");
  assert(previewOnly.preview, "preview must stay visible in preview-only mode");

  // "Go to code" brings the editor back and lands on the line. Selected
  // structurally rather than by label: the app under test runs in whatever
  // language the browser reports.
  await page.click(".pane:last-child .pane-header .sync-btn");
  await page.waitFor("!document.querySelector('.app').className.includes('layout-preview')", {
    message: "going to the code should restore the split view",
  });
  const afterJump = await visibility(page);
  assert(afterJump.editor, "the editor must be visible again after jumping to the code");

  // ── The choice survives a reload ─────────────────────────────────
  await press(page, "3", "ctrlKey: true");
  await page.waitFor("document.querySelector('.app').classList.contains('layout-preview')");
  const stored = await page.evaluate(
    "JSON.parse(localStorage.getItem('meditor.preferences.v1') || '{}').layoutMode",
  );
  assert(stored === "preview", `the mode should be stored, got ${stored}`);

  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor("document.querySelector('.app').classList.contains('layout-preview')", {
    message: "the mode should survive a reload",
  });

  // ── Zen wins while it lasts, and gives the mode back afterwards ───
  await press(page, "F11");
  await page.waitFor("document.querySelector('.app').classList.contains('zen')");
  const zen = await visibility(page);
  assert(zen.editor, "zen mode is a writing mode: the editor must show");
  assert(!zen.preview, "zen mode hides the preview");

  await press(page, "Escape");
  await page.waitFor("!document.querySelector('.app').classList.contains('zen')");
  const backToReading = await visibility(page);
  assert(!backToReading.editor, "leaving zen should restore preview-only mode");
  assert(backToReading.preview, "the preview should be back after leaving zen");

  // Leave the stored preferences as the next spec expects to find them.
  await page.evaluate("localStorage.removeItem('meditor.preferences.v1'); true");

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "PASS: layout-modes.spec — editor / split / preview, repagination, jump back, persistence and zen",
  );
} finally {
  page.close();
}
