/**
 * E2E spec — in-window dialogs and the window close guard.
 *
 * Verifies, in a real headless Chrome:
 *   1. ConfirmDialog: closing a dirty tab shows it; "No" keeps the tab,
 *      "Yes" closes it.
 *   2. RenameDialog: double-clicking a tab opens it pre-filled; Enter renames.
 *   3. Close guard (window X): emitting tauri://close-requested with a dirty
 *      doc shows the confirm; "No" keeps the app open without exit_app;
 *      "Yes" saves the session before calling exit_app.
 *   4. No console errors along the way.
 *
 * The close guard only registers when isTauri() is true, so the spec injects
 * a faithful __TAURI_INTERNALS__ shim (tauri-shim.mjs) before the app loads.
 * The real @tauri-apps/api modules then work against it unmodified.
 *
 * Run via `pnpm test:e2e` (the runner sets CDP_PORT and BASE_URL).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "artifacts");
mkdirSync(artifactsDir, { recursive: true });

const page = await connect(CDP_PORT);
let shimId;
try {
  // Must run before any app script so isTauri() is true from the start.
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')");

  // ── Confirm dialog ────────────────────────────────────────────────
  await page.click(".tab-add"); // second tab → tab-close buttons appear
  await page.waitFor("document.querySelectorAll('.tab').length > 1");

  // Make the active (new) tab dirty by typing into CodeMirror.
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, 'dirty e2e');
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.tab.active .tab-dirty')");

  await page.click(".tab.active .tab-close");
  await page.waitFor("!!document.querySelector('[role=alertdialog]')");
  assert(
    await page.exists(".confirm-btn--primary"),
    "confirm dialog should show its primary action",
  );
  await page.screenshot(join(artifactsDir, "confirm-dialog.png"));

  // "No" keeps the tab (and the dialog closes).
  await page.click(".confirm-btn");
  await page.waitFor("document.querySelector('[role=alertdialog]') === null");
  assert(
    (await page.evaluate("document.querySelectorAll('.tab').length")) === 2,
    "cancelling the confirm dialog must keep the tab",
  );

  // "Yes" closes the tab.
  await page.click(".tab.active .tab-close");
  await page.waitFor("!!document.querySelector('.confirm-btn--primary')");
  await page.click(".confirm-btn--primary");
  await page.waitFor("document.querySelectorAll('.tab').length === 1");

  // ── Rename dialog ─────────────────────────────────────────────────
  await page.evaluate(`(() => {
    document.querySelector('.tab-main').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.rename-input')");
  const prefilled = await page.evaluate(
    "document.querySelector('.rename-input').value",
  );
  assert(
    typeof prefilled === "string" && prefilled.length > 0,
    "rename input should be pre-filled with the current name",
  );
  await page.screenshot(join(artifactsDir, "rename-dialog.png"));

  await page.type(".rename-input", "Renamed in E2E");
  await page.evaluate(`(() => {
    document.querySelector('.rename-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    return true;
  })()`);
  await page.waitFor("document.querySelector('.rename-overlay') === null");
  const tabName = await page.text(".tab-name");
  assert(tabName === "Renamed in E2E", `tab was not renamed (got ${tabName})`);

  // ── Close guard (window X) ───────────────────────────────────────
  // Dirty the remaining tab so the close guard has something to confirm.
  await page.evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    cm.focus();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, ' unsaved guard content');
    return true;
  })()`);
  await page.waitFor("!!document.querySelector('.tab.active .tab-dirty')");

  // Simulate the user pressing the window X: the Rust side emits
  // tauri://close-requested, which the shim replays into the registered
  // onCloseRequested handler (exactly one listener, registered by App).
  const fired = await page.evaluate(
    "window.__meditorEmit('tauri://close-requested', null)",
  );
  assert(fired === 1, `expected 1 close-requested listener, fired ${fired}`);
  await page.waitFor("!!document.querySelector('[role=alertdialog]')");
  await page.screenshot(join(artifactsDir, "close-guard.png"));

  // The guard must preventDefault (the app stays open on our side) and the
  // window must NOT be destroyed by the API wrapper (isPreventDefault true).
  assert(
    !(await page.evaluate("window.__meditorInvoked('plugin:window|destroy')")),
    "onCloseRequested must not destroy the window while the guard runs",
  );

  // "No" keeps the app open without exiting.
  await page.click(".confirm-btn");
  await page.waitFor("document.querySelector('[role=alertdialog]') === null");
  await page.waitFor("document.querySelectorAll('.tab').length === 1");
  assert(
    !(await page.evaluate("window.__meditorInvoked('exit_app')")),
    "cancelling the close guard must not call exit_app",
  );

  // Try closing again and answer "Yes": the dirty session is saved (with
  // its content) before exit_app is invoked.
  await page.evaluate("window.__meditorEmit('tauri://close-requested', null)");
  await page.waitFor("!!document.querySelector('[role=alertdialog]')");
  await page.click(".confirm-btn--primary");
  await page.waitFor(
    "window.__meditorInvoked('exit_app')",
    { timeout: 8000, message: "exit_app should be invoked after confirming" },
  );

  const order = await page.evaluate("window.__meditorInvokeOrder()");
  const saveIdx = order.lastIndexOf("save_session");
  const exitIdx = order.indexOf("exit_app");
  assert(
    saveIdx !== -1 && exitIdx !== -1 && saveIdx < exitIdx,
    `save_session (idx ${saveIdx}) must precede exit_app (idx ${exitIdx})`,
  );
  assert(
    order.filter((cmd) => cmd === "exit_app").length === 1,
    "exit_app must be invoked exactly once",
  );

  // The final save_session payload must include the dirty doc content — the
  // close guard saves the real session before exiting.
  const lastSave = await page.evaluate(`(() => {
    const all = window.__meditorInvokes;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].cmd === 'save_session') return all[i].args;
    }
    return null;
  })()`);
  const savedContent = lastSave?.input?.docs?.[0]?.content ?? "";
  assert(
    savedContent.includes("unsaved guard content"),
    "final save_session must persist the dirty content",
  );

  // ── Console health ────────────────────────────────────────────────
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );

  console.log(
    "PASS: dialogs.spec — confirm (No/Yes) + rename (Enter) + close guard (No/Yes)",
  );
} finally {
  // Remove the shim so it cannot leak into later specs (the runner shares
  // one Chrome/page across specs).
  await page.removeInitScript(shimId);
  page.close();
}
