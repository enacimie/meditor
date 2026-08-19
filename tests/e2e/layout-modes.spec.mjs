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
      paneWidth: +(document.querySelector('.pane')?.getBoundingClientRect().width ?? 0).toFixed(2),
      classes: document.querySelector('.app')?.className ?? '',
    };
  })()`);

const page = await connect(CDP_PORT);
try {
  // Pin the viewport. The workspace stacks vertically below 760px, and the
  // pane widths this spec measures follow from it, so leaving the size to
  // whatever the runner's headless Chrome defaults to makes the result depend
  // on the machine. Cleared in the finally, as shortcuts.spec.mjs does.
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

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

  /*
   * The editor should now own the workspace instead of the split ratio — but
   * wait for the box to say so rather than measuring the instant the class
   * appears. Layout is asynchronous: on a loaded CI runner the browser was
   * still reporting the previous geometry, and the previous `flex`, for a
   * frame or two after React had written the new one. Measuring right away
   * read that stale state and called a working feature broken.
   *
   * Stated as a proportion, not an exact pixel match: a runner is free to
   * spend a stray pixel on rounding or a scrollbar.
   */
  const spansWorkspace = `(() => {
    const p = document.querySelector('.split > .pane');
    const s = document.querySelector('.split');
    if (!p || !s) return false;
    const total = s.getBoundingClientRect().width;
    return total > 0 && p.getBoundingClientRect().width / total > 0.95;
  })()`;
  try {
    await page.waitFor(spansWorkspace, { timeout: 10000, interval: 100 });
  } catch {
    // Never got there. Report what the panes actually declare and compute, so
    // a stale-layout flake and a real layout bug can be told apart.
    const state = await page.evaluate(`(() => ({
      split: +document.querySelector('.split').getBoundingClientRect().width.toFixed(1),
      panes: [...document.querySelectorAll('.split > .pane')].map((p) => {
        const cs = getComputedStyle(p);
        return {
          w: +p.getBoundingClientRect().width.toFixed(1),
          display: cs.display,
          computed: [cs.flexGrow, cs.flexShrink, cs.flexBasis].join('/'),
          declared: p.style.flex,
        };
      }),
    }))()`);
    assert(false, "the visible pane should span the whole workspace: " + JSON.stringify(state));
  }

  const widths = await page.evaluate(`(() => {
    const w = (s) => document.querySelector(s)?.getBoundingClientRect().width ?? 0;
    return {
      pane: +w('.split > .pane').toFixed(2),
      direction: getComputedStyle(document.querySelector('.split')).flexDirection,
    };
  })()`);
  assert(
    widths.direction === "row",
    `the pinned viewport should lay the panes out in a row, got ${widths.direction}`,
  );
  assert(
    widths.pane > split.paneWidth * 1.5,
    `the pane should have grown past the split ratio: ${split.paneWidth} → ${widths.pane}`,
  );

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

  /*
   * ── The mirror of "go to code": from editor-only, reach the preview ──
   *
   * Worth an end-to-end check rather than a unit test, because the hard part
   * only exists in a real browser: while its pane is hidden the preview defers
   * rendering, so at the moment of the click there is nothing to scroll to.
   * The jump has to survive until pagination has run.
   */
  await press(page, "1", "ctrlKey: true");
  await page.waitFor("document.querySelector('.app').classList.contains('layout-editor')");
  await page.click(".pane:first-child .pane-header .sync-btn");
  await page.waitFor("!document.querySelector('.app').className.includes('layout-')", {
    message: "going to the preview should restore the split view",
  });
  await page.waitFor("!!document.querySelector('.preview-scroll .sync-flash')", {
    timeout: 25000,
    interval: 200,
    message: "the preview should land on the cursor once it has rendered",
  });

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
  // Later specs share this browser and expect the default metrics back.
  await page.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  page.close();
}
