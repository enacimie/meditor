/**
 * E2E spec — window zoom in a real browser.
 *
 * Verifies, in a real headless Chrome:
 *   1. Nothing shows at natural size.
 *   2. Ctrl+= steps up the ladder: the status bar says 110% and the page is
 *      actually scaled (the web build scales with CSS zoom).
 *   3. Ctrl+wheel steps in both directions, one notch one step.
 *   4. The status-bar readout is a way back: clicking it returns to 100%.
 *   5. Ctrl+0 is the keyboard's way back.
 *   6. The level is remembered across a reload, glass included.
 *   7. No console errors along the way.
 *
 * Run via `pnpm test:e2e` (the runner sets CDP_PORT and BASE_URL).
 *
 * NOTE: this spec runs WITHOUT the Tauri shim, so the backend underneath is
 * the web one and the zoom lands in CSS — which is exactly what makes it
 * observable from here. On the desktop the same keys reach the webview's own
 * zoom instead; App.shortcuts.test.tsx pins that wiring.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/** Dispatch a keyboard event on window (the app's global shortcut target). */
const press = (page, key, opts = "") =>
  page.evaluate(
    `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ${opts} }));
      return true;
    })()`,
  );

/** Dispatch a Ctrl+wheel notch on window, as a trackpad or mouse would. */
const wheel = (page, deltaY) =>
  page.evaluate(
    `(() => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: ${deltaY}, ctrlKey: true, cancelable: true }));
      return true;
    })()`,
  );

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')");

  // ── Natural size says nothing ──────────────────────────────────────
  assert(
    !(await page.exists(".statusbar-zoom")),
    "the zoom readout should not show at natural size",
  );

  // ── Ctrl+= steps up, and the page follows ──────────────────────────
  await press(page, "=", "ctrlKey: true");
  await page.waitFor(
    "document.querySelector('.statusbar-zoom')?.textContent === '110%'",
    { message: "Ctrl+= should zoom one step and say so in the status bar" },
  );
  await page.waitFor(
    "document.documentElement.style.getPropertyValue('zoom') === '1.1'",
    { message: "the web build should scale the page with CSS zoom" },
  );

  // ── Ctrl+wheel, one notch one step, both ways ──────────────────────
  await wheel(page, -120);
  await page.waitFor(
    "document.querySelector('.statusbar-zoom')?.textContent === '125%'",
    { message: "a Ctrl+wheel notch up should zoom in" },
  );
  await wheel(page, 120);
  await page.waitFor(
    "document.querySelector('.statusbar-zoom')?.textContent === '110%'",
    { message: "a Ctrl+wheel notch down should zoom out" },
  );

  // ── The readout is the way back ────────────────────────────────────
  await page.click(".statusbar-zoom");
  await page.waitFor("!document.querySelector('.statusbar-zoom')", {
    message: "clicking the readout should return to natural size",
  });
  await page.waitFor(
    "document.documentElement.style.getPropertyValue('zoom') === '1'",
  );

  // ── Ctrl+0 is the keyboard's way back ──────────────────────────────
  await press(page, "+", "ctrlKey: true");
  await page.waitFor(
    "document.querySelector('.statusbar-zoom')?.textContent === '110%'",
  );
  await press(page, "0", "ctrlKey: true");
  await page.waitFor("!document.querySelector('.statusbar-zoom')", {
    message: "Ctrl+0 should return to natural size",
  });

  // ── Remembered across a reload ─────────────────────────────────────
  // reload() keeps storage, unlike freshPage: the level has to come back on
  // the glass, not only in the readout.
  await press(page, "=", "ctrlKey: true");
  await page.waitFor(
    "document.querySelector('.statusbar-zoom')?.textContent === '110%'",
  );
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')");
  await page.waitFor(
    "document.querySelector('.statusbar-zoom')?.textContent === '110%'",
    { message: "the remembered zoom should be restored after a reload" },
  );
  await page.waitFor(
    "document.documentElement.style.getPropertyValue('zoom') === '1.1'",
    { message: "the restored zoom should reach the page, not just the state" },
  );

  // ── Console health ─────────────────────────────────────────────────
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );

  console.log(
    "PASS: zoom.spec — Ctrl+=/Ctrl+0 and Ctrl+wheel step the ladder, the readout resets, and the level survives a reload",
  );
} finally {
  page.close();
}
