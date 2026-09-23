/**
 * E2E spec — the web build: the plain-browser code path.
 *
 * Deliberately injects NO Tauri shim, so isTauri() is false and everything
 * below exercises webBackend against a real headless Chrome. The assertions
 * are stateless on purpose — earlier specs legitimately leave sessions in the
 * profile — and check the invariants that matter:
 *
 *   1. Whatever booted, the debounced session writer stores EXACTLY what the
 *      UI shows (same tabs, ids, names, active tab) and never a handle.
 *   2. Freezing that session and reloading restores it identically, end to
 *      end, through webBackend.loadSession.
 *   3. Export PDF reaches the browser's print dialog, once.
 *   4. No console errors along the way.
 *
 * Run via `pnpm test:e2e` (the runner sets CDP_PORT and BASE_URL).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, assert, sleep } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "artifacts");
mkdirSync(artifactsDir, { recursive: true });

const TABS_DUMP = `(() => ({
  tabs: [...document.querySelectorAll('.tab')].map((el) => ({
    // The document id lives on the inner .tab-main, not on the button.
    id: el.querySelector('.tab-main')?.id.replace(/^tab-/, '') ?? '',
    name: el.querySelector('.tab-name')?.textContent,
    active: el.classList.contains('active'),
  })),
}))()`;

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')");
  // Whatever booted, wait until the debounced writer has caught up with the
  // UI actually on screen — polling instead of sleeping keeps this immune to
  // machine speed.
  let ui;
  let storedRaw;
  let converged = false;
  for (let i = 0; i < 25 && !converged; i += 1) {
    await sleep(200);
    ui = await page.evaluate(TABS_DUMP);
    storedRaw = await page.evaluate("localStorage.getItem('meditor.web.session.v3')");
    const s = storedRaw ? JSON.parse(storedRaw) : null;
    converged =
      !!s &&
      s.version === 3 &&
      Array.isArray(s.docs) &&
      ui.tabs.length > 0 &&
      ui.tabs.every((el) => s.docs.some((d) => d.id === el.id.replace(/^tab-/, "")));
  }
  if (!converged) {
    console.log("[web.spec] UI:", JSON.stringify(ui));
    console.log("[web.spec] STORED:", storedRaw);
    console.log(
      "[web.spec] TABS-HTML:",
      await page.evaluate("[...document.querySelectorAll('.tab')].map((el) => el.outerHTML.slice(0, 160))"),
    );
    throw new Error("the web session never converged with the open tabs");
  }

  // ── Storage mirrors the UI exactly ──────────────────────────────────
  assert(ui.tabs.length > 0, "no tabs rendered");
  assert(storedRaw, "the web session was never written");
  const stored = JSON.parse(storedRaw);
  assert(stored.version === 3, `unexpected session version ${stored.version}`);
  assert(
    stored.docs.length === ui.tabs.length,
    `session holds ${stored.docs.length} docs for ${ui.tabs.length} tabs`,
  );
  for (const tab of ui.tabs) {
    const doc = stored.docs.find((d) => d.id === tab.id);
    assert(doc, `tab "${tab.name}" missing from the stored session`);
    assert(doc.name === tab.name, `name drift for ${tab.id}: "${doc.name}"`);
    assert(doc.handle == null, "handles must not persist across reloads");
  }
  const activeTab = ui.tabs.find((t) => t.active);
  assert(activeTab, "no active tab in the UI");
  assert(stored.activeId === activeTab.id, "stored active tab mismatch");

  // ── Freeze the session ourselves, reload, expect an identical restore ──
  await page.evaluate(
    `localStorage.clear(); localStorage.setItem('meditor.web.session.v3', ${JSON.stringify(storedRaw)}); true`,
  );
  await page.reload();
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  const restored = await page.evaluate(TABS_DUMP);
  assert(
    restored.tabs.length === ui.tabs.length,
    `restored ${restored.tabs.length} tabs for ${ui.tabs.length} frozen ones`,
  );
  const restoredActive = restored.tabs.find((t) => t.active);
  assert(restoredActive, "no active tab after restore");
  assert(
    restoredActive.name === activeTab.name,
    `restore activated "${restoredActive.name}" instead of "${activeTab.name}"`,
  );

  // ── Export PDF reaches the browser's print dialog ───────────────────
  // The web backend's exportPdf is window.print(), so the calls are counted
  // instead of letting headless Chrome open a dialog. A fresh tab makes the
  // active document Markdown whatever the restored session held, and the entry
  // is found by its shortcut label, which reads "Ctrl+E" in every language.
  // Looking and using happen in one evaluation: the menu is React's to redraw.
  const exported = await page.evaluate(`(async () => {
    window.__printCalls = 0;
    window.print = () => { window.__printCalls += 1; };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    const deadline = Date.now() + 5000;
    const until = async (check) => {
      while (Date.now() < deadline) {
        const found = check();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    const toggle = await until(() => document.querySelector('.menu-toggle:not([disabled])'));
    if (!toggle) return { error: 'no enabled menu toggle' };
    toggle.click();
    const entry = await until(() => [...document.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.querySelector('.shortcut')?.textContent === 'Ctrl+E'));
    if (!entry) return { error: 'no Export PDF entry in the menu' };
    entry.click();
    await until(() => window.__printCalls > 0);
    return { calls: window.__printCalls };
  })()`);
  assert(!exported.error, `export check could not run: ${exported.error}`);
  assert(
    exported.calls === 1,
    `Export PDF reached the print dialog ${exported.calls} times instead of once`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "web.spec ok — no Tauri runtime, session mirrors UI and survives a reload, export prints",
  );
} finally {
  page.close();
}
