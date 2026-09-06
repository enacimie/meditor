/**
 * E2E spec — reopening a document from the recent list.
 *
 * The list is drawn from names the backend supplies and clicked by *position*:
 * the web layer never names a file to open. That is the security property the
 * feature exists to preserve, and it is also the thing most likely to break
 * quietly, because opening the row below the one clicked still opens *a*
 * document and still looks like it worked.
 *
 * So the spec clicks the second row and checks that the second document is
 * what arrives — not merely that something did.
 *
 * The shim's documents are its own, so the shared session is left untouched.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({
  recent: [
    { name: "primero.md", path: "/home/e/work/primero.md", content: "# Primero\n" },
    { name: "segundo.md", path: "/home/e/otro/segundo.md", content: "# Segundo\n" },
    { name: "tercero.md", path: "/home/e/work/tercero.md", content: "# Tercero\n" },
  ],
})};`;

/** The recent rows currently in the open menu. */
const recentRows = () =>
  page.read(`[...document.querySelectorAll('[role="menu"] .menu-recent')]
    .map((el) => ({ name: el.textContent, path: el.getAttribute('title') }))`);

const openMenu = () =>
  page.evaluate(`(() => {
    const toggle = document.querySelector('button[aria-haspopup="menu"]');
    if (!(toggle instanceof HTMLElement)) return false;
    toggle.click();
    return true;
  })()`);

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The menu lists them, freshest first, with the path to hand ───────
  assert(await openMenu(), "the more-options menu should have a toggle");
  await page.waitFor(`document.querySelectorAll('[role="menu"] .menu-recent').length === 3`, {
    timeout: 10000,
    message: "the three recent documents should be in the menu",
  });
  const rows = await recentRows();
  assert(
    JSON.stringify(rows.map((r) => r.name)) ===
      JSON.stringify(["primero.md", "segundo.md", "tercero.md"]),
    `the rows should be in the backend's order, got ${JSON.stringify(rows)}`,
  );
  assert(
    rows[1].path === "/home/e/otro/segundo.md",
    `each row should carry its path for the tooltip, got ${rows[1].path}`,
  );

  // ── Clicking the second row opens the second document ────────────────
  await page.evaluate(
    `document.querySelectorAll('[role="menu"] .menu-recent')[1].click()`,
  );
  await page.waitFor(
    `[...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent === '# Segundo')`,
    { timeout: 15000, message: "clicking the second row should open the second document" },
  );

  // ── The web layer asked for a position, not for a path ───────────────
  // The point of the whole design: if this ever becomes a path, a bug in the
  // frontend becomes a way to read any file the user can.
  const calls = await page.read(
    `window.__meditorInvokes.filter((i) => i.cmd === 'open_recent').map((i) => i.args)`,
  );
  assert(
    calls.length === 1 && calls[0].index === 1,
    `open_recent should have been asked for index 1, once, got ${JSON.stringify(calls)}`,
  );
  assert(
    !JSON.stringify(calls).includes("/home/"),
    `no path should have crossed the boundary, got ${JSON.stringify(calls)}`,
  );

  // ── And the list reorders, so the next click still lands right ───────
  // Opening moves a document to the front. A menu still showing the old order
  // would send a position that now means a different file.
  assert(await openMenu(), "the menu should open again");
  await page.waitFor(
    `document.querySelectorAll('[role="menu"] .menu-recent')[0]?.textContent === 'segundo.md'`,
    { timeout: 10000, message: "the document just opened should have moved to the top" },
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while reopening: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    "PASS: recent-files.spec — three rows in the backend's order, clicking the second " +
      "opens the second by index, and the list reorders behind it",
  );
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
