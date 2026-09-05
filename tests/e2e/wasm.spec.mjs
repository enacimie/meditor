/**
 * E2E spec — real WASM smoke coverage.
 *
 * Typst is tested end-to-end with the complete bundled sample. LaTeX is split
 * into local engine loading and remote package resolution: the PdfTeX worker
 * and its WASM are deterministic, while compilation also depends on the
 * SwiftLaTeX TeX Live endpoint and should not make CI depend on that service.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", {
    timeout: 15000,
  });

  /*
   * Three synchronous steps rather than one asynchronous one.
   *
   * This call is where `Promise was collected (-32000)` has been landing. It
   * used to click the menu open, `await` a zero-delay timer and click the item
   * on the other side of it, which leaves Chrome awaiting a page-side promise
   * across a task boundary — the one shape in this suite that has ever failed
   * that way, and the shape the LaTeX probe below was already moved off.
   *
   * A synchronous expression returns its value outright: there is no pending
   * promise for the protocol to lose. The waiting moves to `waitFor`, which
   * has tolerated transient errors all along.
   */
  const MENU_ITEMS = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')]`;
  const TYPST_ITEM =
    `${MENU_ITEMS}.find((el) => /typst/i.test(el.textContent || '') ` +
    `|| (el.textContent || '').toLowerCase().includes('.typ'))`;

  const menuOpened = await page.evaluate(`(() => {
    const menuToggle = document.querySelector('button[aria-haspopup="menu"]');
    if (!(menuToggle instanceof HTMLElement)) return false;
    menuToggle.click();
    return true;
  })()`);
  assert(menuOpened, "the more-options menu should have a toggle to click");

  await page.waitFor(`!!(${TYPST_ITEM})`, {
    timeout: 10000,
    message: "Typst action should be available in the more-options menu",
  });

  const typstMenuItem = await page.evaluate(`(() => {
    const item = ${TYPST_ITEM};
    if (!(item instanceof HTMLElement)) return false;
    item.click();
    return true;
  })()`);
  assert(typstMenuItem, "the Typst menu item should be clickable");

  await page.waitFor("!!document.querySelector('.typst-svg-wrapper svg')", {
    timeout: 45000,
    message: "the complete Typst sample should compile to SVG",
  });

  /*
   * Start the engine load, then poll for its answer, rather than holding one
   * `Runtime.evaluate` open for the whole minute it can take.
   *
   * That single long call was the flakiest thing in the suite: it failed
   * intermittently with `Promise was collected (-32000)`, on macOS and on
   * Windows, and took the run down with it. cdp.mjs already classes that error
   * as transient — "worth retrying, never worth failing on" — but only
   * `waitFor` acts on the classification; an awaited `evaluate` propagates it
   * and ends the spec.
   *
   * Splitting it moves the waiting onto the path that already handles this:
   * the kick-off returns at once, the page keeps its own reference to the
   * promise, and the polling runs under `waitFor`. Whether that was the whole
   * cause is not something a green run can settle — the failure was never
   * reproducible on demand — but the spec no longer keeps an evaluation open
   * across the work that used to lose it.
   */
  await page.evaluate(`(() => {
    window.__latexProbe = (async () => {
      let engine;
      try {
        const { getLatexEngineClass } = await import('/src/latexEngine.ts');
        const Engine = await getLatexEngineClass();
        engine = new Engine();
        await Promise.race([
          engine.loadEngine(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('load timeout')), 40000)),
        ]);
        window.__latexResult = { ok: true };
      } catch (error) {
        window.__latexResult = { ok: false, error: String(error) };
      } finally {
        try { engine?.closeWorker(); } catch { /* best effort */ }
      }
    })();
    return true;
  })()`);

  await page.waitFor("!!window.__latexResult", {
    timeout: 60000,
    interval: 500,
    message: "the LaTeX engine should finish loading, or say why it could not",
  });

  // A pure read, so it may be retried: the engine has just finished a
  // minute of WASM loading and this is exactly when the context has been
  // seen to drop an evaluation on Windows CI.
  const latexLoad = await page.read("window.__latexResult");
  assert(latexLoad.ok, `LaTeX local WASM worker failed: ${latexLoad.error || "unknown error"}`);

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "PASS: wasm.spec — Typst sample compile + LaTeX worker/WASM load" +
      (page.transientReads ? ` (${page.transientReads} read(s) retried)` : ""),
  );
} finally {
  page.close();
}
