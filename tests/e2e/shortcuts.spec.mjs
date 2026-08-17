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

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "artifacts");
mkdirSync(artifactsDir, { recursive: true });

/** Dispatch a keyboard event on window (the app's global shortcut target). */
/**
 * CodeMirror registers its keymap on the editor itself, so a shortcut handled
 * by the editor (rather than by the app's window listener) has to be
 * dispatched there.
 */
const pressInEditor = (page, key, opts = "") =>
  page.evaluate(
    `(() => {
      const el = document.querySelector('.cm-content');
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ${opts} }));
      return true;
    })()`,
  );

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

  // ── Outline semantics and Zen exit affordance ─────────────────────
  const outlineToggle = '[aria-controls="document-outline"]';
  assert(await page.exists(outlineToggle), "outline toggle should expose aria-controls");
  assert(
    (await page.evaluate(`document.querySelector(${JSON.stringify(outlineToggle)}).getAttribute('aria-expanded')`)) === "false",
    "outline should start collapsed",
  );
  await page.click(outlineToggle);
  await page.waitFor(`document.querySelector(${JSON.stringify(outlineToggle)}).getAttribute('aria-expanded') === 'true'`);
  assert(await page.exists("#document-outline"), "outline panel should have a stable id");
  await page.click(outlineToggle);

  await press(page, "F11");
  await page.waitFor("!!document.querySelector('.app.zen')");
  assert(await page.exists(".zen-exit"), "Zen mode should expose a visible exit control");
  await press(page, "Escape");
  await page.waitFor("!document.querySelector('.app.zen')");

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

  // ── Narrow viewport overlay ───────────────────────────────────────
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    await press(page, "F1");
    await page.waitFor("!!document.querySelector('.shortcuts-overlay')");
    const narrowOverlay = await page.evaluate(`(() => {
      const panel = document.querySelector('.shortcuts-panel');
      const rect = panel.getBoundingClientRect();
      const typst = document.querySelector('.format-badge');
      const latex = [...document.querySelectorAll('.format-badge')].find((el) => el.textContent === 'λ');
      return {
        right: rect.right,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        typstDisplay: typst ? getComputedStyle(typst).display : 'missing',
        latexDisplay: latex ? getComputedStyle(latex).display : 'missing',
      };
    })()`);
    assert(narrowOverlay.right <= narrowOverlay.viewport, "shortcuts panel should fit a 320px viewport");
    assert(narrowOverlay.scrollWidth <= narrowOverlay.viewport, "narrow overlay should not create horizontal overflow");
    assert(narrowOverlay.typstDisplay !== 'none', "Typst badge should be visible in compact toolbar");
    assert(narrowOverlay.latexDisplay !== 'none', "LaTeX badge should be visible in compact toolbar");
    await page.evaluate("document.querySelector('.shortcuts-overlay').click()");
    await page.waitFor("document.querySelector('.shortcuts-overlay') === null");
  } finally {
    await page.send("Emulation.clearDeviceMetricsOverride");
  }

  // ── Ctrl+H opens find & replace, Ctrl+G goes to line ──────────────
  // Both are advertised in the README and the overlay. Ctrl+G in particular
  // must win over searchKeymap, which binds Mod-g to "find next".
  await pressInEditor(page, "h", "ctrlKey: true");
  await page.waitFor("!!document.querySelector('.cm-panel.cm-search')", {
    message: "Ctrl+H should open the search panel",
  });
  const replaceRow = await page.evaluate(`(() => {
    const panel = document.querySelector('.cm-panel.cm-search');
    const fields = panel ? panel.querySelectorAll('input.cm-textfield').length : 0;
    const buttons = panel ? [...panel.querySelectorAll('button')].map((b) => b.textContent) : [];
    return { fields, buttons };
  })()`);
  assert(
    replaceRow.fields >= 2,
    `find & replace should expose a replace field (found ${replaceRow.fields})`,
  );

  // Close the panel so the next shortcut starts from a clean state.
  await press(page, "Escape");

  await pressInEditor(page, "g", "ctrlKey: true");
  // The go-to-line dialog is built from the generic showDialog() helper, so it
  // is identified by its input rather than by a dedicated panel class.
  await page.waitFor("!!document.querySelector('.cm-panel input[name=\"line\"]')", {
    message: "Ctrl+G should open the go-to-line dialog, not find-next",
  });
  await press(page, "Escape");

  // ── Console health ────────────────────────────────────────────────
  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );

  console.log(
    "PASS: shortcuts.spec — F1 overlay + Ctrl+K find + Ctrl+H replace + Ctrl+G go-to-line",
  );
} finally {
  page.close();
}
