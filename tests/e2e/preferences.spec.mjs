/**
 * E2E spec — preferences dialog.
 *
 * Verifies, in a real headless Chrome, that the editor typography can be
 * changed from the dialog, that the change reaches CodeMirror straight away
 * and that it survives a reload (it is persisted with the other preferences).
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

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')");

  // ── Ctrl+, opens the dialog ───────────────────────────────────────
  assert(!(await page.exists(".prefs-overlay")), "dialog should start closed");
  await press(page, ",", "ctrlKey: true");
  await page.waitFor("!!document.querySelector('.prefs-overlay')", {
    message: "Ctrl+, should open preferences",
  });

  const modal = await page.evaluate(`(() => {
    const el = document.querySelector('.prefs-overlay');
    return { role: el?.getAttribute('role'), modal: el?.getAttribute('aria-modal') };
  })()`);
  assert(modal.role === "dialog", "preferences should be a dialog");
  assert(modal.modal === "true", "preferences should be aria-modal");

  // ── Changing the font size reaches the editor ─────────────────────
  const before = await page.evaluate(
    "getComputedStyle(document.querySelector('.cm-editor')).fontSize",
  );
  await page.evaluate(`(() => {
    const slider = document.querySelector('#prefs-font-size');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '20');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await page.waitFor(
    "getComputedStyle(document.querySelector('.cm-editor')).fontSize === '20px'",
    { message: `editor font size should follow the slider (was ${before})` },
  );

  // ── The spell checker toggle reaches the content element ──────────
  // CodeMirror hard-codes spellcheck="false"; the preference must override it,
  // which is what hands the text to the platform checker.
  const spellDefault = await page.evaluate(
    "document.querySelector('.cm-content').getAttribute('spellcheck')",
  );
  assert(
    spellDefault === "true",
    `spell check should be on by default, got ${spellDefault}`,
  );
  await page.evaluate(`(() => {
    const box = document.querySelector('#prefs-spellcheck');
    box.click();
    return true;
  })()`);
  await page.waitFor(
    "document.querySelector('.cm-content').getAttribute('spellcheck') === 'false'",
    { message: "turning the preference off should disable spell check" },
  );
  await page.evaluate("document.querySelector('#prefs-spellcheck').click(); true");
  await page.waitFor(
    "document.querySelector('.cm-content').getAttribute('spellcheck') === 'true'",
    { message: "turning it back on should re-enable spell check" },
  );

  // ── Escape closes it ──────────────────────────────────────────────
  await page.evaluate(`(() => {
    document.querySelector('.prefs-overlay').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    return true;
  })()`);
  await page.waitFor("document.querySelector('.prefs-overlay') === null");

  // ── The choice is persisted ───────────────────────────────────────
  const stored = await page.evaluate(
    "JSON.parse(localStorage.getItem('meditor.preferences.v1') || '{}').editorFontSize",
  );
  assert(stored === 20, `font size should be stored, got ${stored}`);

  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')");
  await page.waitFor(
    "getComputedStyle(document.querySelector('.cm-editor')).fontSize === '20px'",
    { message: "font size should survive a reload" },
  );

  // Leave the stored preferences as they were for the next spec.
  await page.evaluate(
    "localStorage.removeItem('meditor.preferences.v1'); true",
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "PASS: preferences.spec — Ctrl+, opens, font size + spell check apply live and persist",
  );
} finally {
  page.close();
}
