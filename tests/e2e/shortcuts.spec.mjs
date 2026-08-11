/**
 * E2E spec — keyboard shortcuts in a real browser.
 *
 * Verifies, in a real headless Chrome:
 *   1. F1 opens the shortcuts overlay (role=dialog, lists shortcuts).
 *   2. Escape closes it (through the exit animation).
 *   3. Ctrl+K opens the CodeMirror search panel and focuses its input.
 *   4. Typing a query highlights matches in the document.
 *   5. Ctrl+K is open-only: pressing it while an input has focus does not
 *      steal the focus (no search panel opens from a foreign input).
 *   6. No console errors along the way.
 *
 * Run via `pnpm test:e2e` (the runner sets CDP_PORT and BASE_URL).
 *
 * NOTE: this spec runs WITHOUT the Tauri shim (dialogs.spec cleans it up in
 * its finally, and specs share one Chrome/page in alphabetical order:
 * contrast → dialogs → shortcuts). It must stay after dialogs.spec.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "artifacts");
mkdirSync(artifactsDir, { recursive: true });

/** Dispatch a keyboard event on window (the app's global shortcut target). */
const press = (page, key, opts = "") =>
  page.evaluate(
    `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ${opts} }));
      return true;
    })()`,
  );

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')");

  // ── F1 opens the shortcuts overlay ────────────────────────────────
  assert(
    !(await page.exists(".shortcuts-overlay")),
    "overlay should start closed",
  );
  await press(page, "F1");
  await page.waitFor("!!document.querySelector('.shortcuts-overlay')");
  const dialog = await page.evaluate(
    `(() => {
      const el = document.querySelector('.shortcuts-overlay');
      const rows = [...document.querySelectorAll('.shortcuts-row')].map((r) => r.textContent);
      return { modal: el?.getAttribute('aria-modal'), rows, ctrlK: rows.some((t) => t.includes('Ctrl+K')), f2: rows.some((t) => t.includes('F2')) };
    })()`,
  );
  assert(dialog.modal === "true", "overlay should be aria-modal");
  assert(
    dialog.rows.length >= 10,
    `overlay should list the shortcuts (got ${dialog.rows.length} rows)`,
  );
  // The requirement: Ctrl+K is discoverable in the overlay.
  assert(dialog.ctrlK, "overlay must list the Ctrl+K shortcut");
  assert(dialog.f2, "overlay must list the F2 shortcut");
  await page.screenshot(join(artifactsDir, "shortcuts-overlay.png"));

  // The close button should have focus (a11y).
  const focusedClose = await page.evaluate(
    "document.activeElement?.classList.contains('shortcuts-close')",
  );
  assert(focusedClose, "close button should be focused when the overlay opens");

  // ── Escape closes it ──────────────────────────────────────────────
  await page.evaluate(`(() => {
    document.querySelector('.shortcuts-overlay').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    return true;
  })()`);
  await page.waitFor("document.querySelector('.shortcuts-overlay') === null");

  // Re-open with F1 and close via the backdrop click.
  await press(page, "F1");
  await page.waitFor("!!document.querySelector('.shortcuts-overlay')");
  await page.evaluate(`(() => {
    document.querySelector('.shortcuts-overlay').click();
    return true;
  })()`);
  await page.waitFor("document.querySelector('.shortcuts-overlay') === null");

  // ── Ctrl+K opens the find panel ───────────────────────────────────
  assert(
    !(await page.exists(".cm-search")),
    "search panel should start closed",
  );
  await press(page, "k", "ctrlKey: true");
  await page.waitFor("!!document.querySelector('.cm-search')");

  const findInput = await page.evaluate(
    "(() => { const el = document.querySelector('.cm-textfield'); return { exists: !!el, focused: document.activeElement === el }; })()",
  );
  assert(findInput.exists, "search input should exist");
  await page.waitFor(
    "document.activeElement === document.querySelector('.cm-textfield')",
    { message: "search input should be focused after Ctrl+K" },
  );
  await page.screenshot(join(artifactsDir, "find-panel.png"));

  // Type a query — matches must be highlighted in the document.
  await page.type(".cm-textfield", "markdown");
  await page.waitFor(
    "document.querySelectorAll('.cm-searchMatch').length > 0",
    { message: "typing a query should highlight matches" },
  );
  const matches = await page.evaluate(
    "document.querySelectorAll('.cm-searchMatch').length",
  );
  assert(matches > 0, `expected highlighted matches, got ${matches}`);

  // ── Ctrl+K must not steal focus from a foreign input ─────────────
  await page.evaluate(`(() => {
    const input = document.createElement('input');
    input.className = 'foreign-e2e-input';
    document.body.appendChild(input);
    input.focus();
    return true;
  })()`);
  await press(page, "k", "ctrlKey: true");
  // The search panel is already open; the key guard must ignore the press
  // because focus sits in a foreign input. Verify focus was not moved.
  const focusAfter = await page.evaluate(
    "document.activeElement?.className",
  );
  assert(
    focusAfter === "foreign-e2e-input",
    `Ctrl+K must not steal focus (got ${focusAfter})`,
  );
  await page.evaluate(`(() => {
    document.querySelector('.foreign-e2e-input')?.remove();
    return true;
  })()`);

  // Close the search panel with Escape from its own input.
  await page.evaluate(`(() => {
    document.querySelector('.cm-textfield').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    return true;
  })()`);
  await page.waitFor("document.querySelector('.cm-search') === null");

  // ── Console health ────────────────────────────────────────────────
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );

  console.log(
    "PASS: shortcuts.spec — F1 overlay (open/Esc/backdrop) + Ctrl+K find (open/focus/highlight/guard)",
  );
} finally {
  page.close();
}
