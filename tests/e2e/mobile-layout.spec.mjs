/**
 * E2E spec — the touch layout.
 *
 * Everything here depends on real layout and on a real `matchMedia`, so jsdom
 * cannot answer any of it: whether a control is actually 44px on screen,
 * whether the split pane is offered at all, whether tapping a paragraph in the
 * reader throws you into the editor.
 *
 * The phone is emulated three ways at once because they answer different
 * questions: device metrics set the size, touch emulation sets
 * `navigator.maxTouchPoints`, and the emulated media feature is what
 * `(pointer: coarse)` — the thing both the stylesheet and useCoarsePointer
 * actually ask — reads.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/** Apple's and Google's shared minimum for something a finger must hit. */
const TOUCH_MIN = 44;

const boxes = (page, selector) =>
  page.evaluate(`(() => {
    return [...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24),
      };
    });
  })()`);

const page = await connect(CDP_PORT);
let shimId;
try {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 740,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await page.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "pointer", value: "coarse" },
      { name: "any-pointer", value: "coarse" },
      { name: "hover", value: "none" },
    ],
  });

  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // The whole spec is meaningless if the app cannot see the emulation, so
  // check that first and say so plainly rather than failing ten obscure
  // assertions further down.
  const coarse = await page.evaluate("window.matchMedia('(pointer: coarse)').matches");
  assert(coarse, "the emulated media should report a coarse pointer");

  // ── The workspace is one pane or the other ────────────────────────
  const layoutButtons = await boxes(page, ".layout-switch button");
  assert(
    layoutButtons.length === 2,
    `the switch should offer two layouts on a touch screen, got ${layoutButtons.length}`,
  );
  const tooSmall = layoutButtons.filter((b) => b.w < TOUCH_MIN || b.h < TOUCH_MIN);
  assert(
    tooSmall.length === 0,
    `layout buttons under ${TOUCH_MIN}px: ${JSON.stringify(tooSmall)}`,
  );

  // Reading mode, not split: a stored `split` is migrated, and the default is
  // the reader because that is what a phone is for here.
  await page.waitFor("document.querySelector('.app').classList.contains('layout-preview')", {
    message: "a touch screen should land in reading mode, not split",
  });
  const dividerShown = await page.evaluate(
    "!!document.querySelector('.split-divider')?.offsetParent",
  );
  assert(!dividerShown, "there is nothing to divide when only one pane is shown");

  // ── Everything a finger has to hit is big enough ──────────────────
  for (const selector of [".actions button", ".pane-header .sync-btn"]) {
    const small = (await boxes(page, selector)).filter(
      (b) => b.h > 0 && (b.h < TOUCH_MIN || b.w < TOUCH_MIN),
    );
    assert(small.length === 0, `${selector} under ${TOUCH_MIN}px: ${JSON.stringify(small)}`);
  }

  // ── Nothing runs off the side ─────────────────────────────────────
  const overflow = await page.evaluate(`(() => ({
    body: document.documentElement.scrollWidth,
    view: window.innerWidth,
    statusbar: Math.round(document.querySelector('.statusbar')?.scrollWidth ?? 0),
    statusbarBox: Math.round(document.querySelector('.statusbar')?.clientWidth ?? 0),
  }))()`);
  assert(
    overflow.body <= overflow.view + 1,
    `the page should not scroll sideways: ${JSON.stringify(overflow)}`,
  );
  assert(
    overflow.statusbar <= overflow.statusbarBox + 1,
    `the status bar should fit its own width: ${JSON.stringify(overflow)}`,
  );

  // ── The web view is the default, because A4 is 794px wide ─────────
  // Both containers are always in the DOM; only one of them is displayed.
  const previewMode = await page.evaluate(`(() => ({
    paged: !!document.querySelector('.paged-view')?.offsetParent,
    web: !!document.querySelector('.markdown-body')?.offsetParent,
    label: document.querySelector('.pane-view-label')?.textContent?.trim() ?? null,
    labelWidth: +(document.querySelector('.pane-view-label')?.getBoundingClientRect().width ?? 0).toFixed(1),
  }))()`);
  assert(
    !previewMode.paged && previewMode.web,
    `a phone should open in the web view, not paginated A4: ${JSON.stringify(previewMode)}`,
  );
  // The Document/Web button is nothing but its label — a rule that hid button
  // text on narrow screens used to blank it completely.
  assert(
    previewMode.labelWidth > 8,
    `the view-mode button must show its label, got ${JSON.stringify(previewMode)}`,
  );

  // ── Tapping the text you are reading must not open the editor ─────
  await page.waitFor("!!document.querySelector('.markdown-body [data-line]')", {
    timeout: 20000,
  });
  await page.evaluate(`(() => {
    document.querySelector('.markdown-body [data-line]').click();
    return true;
  })()`);
  const afterTap = await page.evaluate(`(() => ({
    classes: document.querySelector('.app').className,
    marked: !!document.querySelector('.sync-marked'),
    editorFocused: !!document.activeElement?.closest('.cm-editor'),
  }))()`);
  assert(
    afterTap.classes.includes("layout-preview"),
    `a tap must not change the layout, got "${afterTap.classes}"`,
  );
  assert(!afterTap.editorFocused, "a tap must not put the caret in the hidden editor");
  assert(afterTap.marked, "a tap should still mark the spot for the go-to-code button");

  // ── The way back to the source lands on the source ────────────────
  await page.click(".pane:last-child .pane-header .sync-btn");
  await page.waitFor("document.querySelector('.app').classList.contains('layout-editor')", {
    message: "with no split to fall back on, 'go to code' should show the editor",
  });

  // ── Undo and redo exist, because a touch keyboard has no Ctrl ─────
  await page.waitFor("!!document.querySelector('.cm-content')");
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, 'TYPED-ON-A-PHONE');
    return true;
  })()`);
  await page.waitFor("document.querySelector('.cm-content').textContent.includes('TYPED-ON-A-PHONE')");

  const historyButtons = await boxes(page, ".pane:first-child .pane-header .history-btn");
  assert(
    historyButtons.length === 2,
    `the editor header should carry undo and redo on touch, found ${historyButtons.length}`,
  );
  // Indexed rather than selected by label: the app under test runs in
  // whatever language the browser reports, and `:nth-of-type` counts buttons
  // rather than history buttons.
  await page.evaluate(`(() => {
    document.querySelectorAll('.pane:first-child .pane-header .history-btn')[0].click();
    return true;
  })()`);
  await page.waitFor(
    "!document.querySelector('.cm-content').textContent.includes('TYPED-ON-A-PHONE')",
    { message: "the undo button should undo" },
  );
  await page.evaluate(`(() => {
    document.querySelectorAll('.pane:first-child .pane-header .history-btn')[1].click();
    return true;
  })()`);
  await page.waitFor(
    "document.querySelector('.cm-content').textContent.includes('TYPED-ON-A-PHONE')",
    { message: "the redo button should redo" },
  );

  // ── The menu fits on screen ───────────────────────────────────────
  await page.click(".menu-toggle");
  await page.waitFor("!!document.querySelector('.menu-panel')");
  const menu = await page.evaluate(`(() => {
    const panel = document.querySelector('.menu-panel');
    const r = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return {
      bottom: +r.bottom.toFixed(1),
      viewport: window.innerHeight,
      overflowY: style.overflowY,
      scrollable: panel.scrollHeight > panel.clientHeight,
      items: panel.querySelectorAll('[role=menuitem]').length,
    };
  })()`);
  assert(
    menu.bottom <= menu.viewport + 1,
    `the menu must stay on screen: ${JSON.stringify(menu)}`,
  );
  assert(
    menu.overflowY === "auto" || menu.overflowY === "scroll",
    `a menu taller than the screen has to scroll, got overflow-y: ${menu.overflowY}`,
  );
  const menuItems = (await boxes(page, ".menu-panel [role=menuitem]")).filter(
    (b) => b.h > 0 && b.h < TOUCH_MIN,
  );
  assert(menuItems.length === 0, `menu rows under ${TOUCH_MIN}px: ${JSON.stringify(menuItems)}`);
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true",
  );

  /*
   * ── The session is written before the app can be killed ───────────
   *
   * Android never fires the window's close request: it freezes the webview on
   * a switch away and may kill the process later without another word. The
   * only guaranteed moment is `visibilitychange`, and the point of flushing
   * there is that it does not wait for the 500ms debounce — so the assertion
   * is that a write lands well inside that window.
   */
  const before = await page.evaluate(
    "window.__meditorInvokes.filter((i) => i.cmd === 'save_session').length",
  );
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, ' about to be backgrounded');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
  await page.waitFor(
    `window.__meditorInvokes.filter((i) => i.cmd === 'save_session').length > ${before}`,
    {
      timeout: 400,
      interval: 25,
      message:
        "going to the background should write the session at once, not wait for the debounce",
    },
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "PASS: mobile-layout.spec — two-pane switch, 44px targets, web preview, tap-safe reading, undo/redo, scrollable menu, background flush",
  );
} finally {
  // Later specs share this browser and expect a desktop again.
  await page.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
  await page
    .send("Emulation.setTouchEmulationEnabled", { enabled: false })
    .catch(() => {});
  await page.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  page.close();
}
