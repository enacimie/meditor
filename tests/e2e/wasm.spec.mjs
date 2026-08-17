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

  const typstMenuItem = await page.evaluate(`(async () => {
    const menuToggle = document.querySelector('button[aria-haspopup="menu"]');
    if (!(menuToggle instanceof HTMLElement)) return false;
    menuToggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const menu = document.querySelector('[role="menu"]');
    const item = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((el) =>
      /typst/i.test(el.textContent || '') || (el.textContent || '').toLowerCase().includes('.typ'),
    );
    if (!(item instanceof HTMLElement)) return false;
    item.click();
    return true;
  })()`);
  assert(typstMenuItem, "Typst action should be available in the more-options menu");

  await page.waitFor("!!document.querySelector('.typst-svg-wrapper svg')", {
    timeout: 45000,
    message: "the complete Typst sample should compile to SVG",
  });

  const latexLoad = await page.evaluate(`(async () => {
    let engine;
    try {
      const { getLatexEngineClass } = await import('/src/latexEngine.ts');
      const Engine = await getLatexEngineClass();
      engine = new Engine();
      await Promise.race([
        engine.loadEngine(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('load timeout')), 40000)),
      ]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    } finally {
      try { engine?.closeWorker(); } catch { /* best effort */ }
    }
  })()`);
  assert(latexLoad.ok, `LaTeX local WASM worker failed: ${latexLoad.error || "unknown error"}`);

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log("PASS: wasm.spec — Typst sample compile + LaTeX worker/WASM load");
} finally {
  page.close();
}
