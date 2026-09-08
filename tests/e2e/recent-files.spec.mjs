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
let emptyConfigId;
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

  // ── With nothing to reopen, the section is still there ───────────────
  // A fresh install has an empty list, and the section has to survive it:
  // a menu whose rows appear only once they are populated never teaches
  // anyone that reopening exists. Only the frontend can be caught getting
  // this wrong — `recentAvailable` in App.tsx decides it, and no unit test
  // sees that decision.
  await page.removeInitScript(configId);
  configId = undefined;
  emptyConfigId = await page.addInitScript(
    `window.__meditorShimConfig = ${JSON.stringify({ recent: [] })};`,
  );
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  assert(await openMenu(), "the menu should open on the empty run");
  await page.waitFor(
    `!!document.querySelector('[role="menu"] .menu-recent-empty')`,
    { timeout: 10000, message: "the empty list should still draw its row" },
  );
  // Read structurally, never by the words: this browser is shared and picks
  // up the machine's language, so the menu here is in Spanish. `.menu-heading`
  // belongs to this section alone, which is what makes its presence an
  // assertion rather than a guess. The wording is the unit tests' job.
  const emptyState = await page.read(`({
    headings: document.querySelectorAll('[role="menu"] .menu-heading').length,
    headingText: document.querySelector('[role="menu"] .menu-heading')?.textContent ?? '',
    rows: document.querySelectorAll('[role="menu"] .menu-recent').length,
    emptyText: document.querySelector('[role="menu"] .menu-recent-empty').textContent,
    ariaDisabled: document.querySelector('[role="menu"] .menu-recent-empty')
      .getAttribute('aria-disabled'),
    reallyDisabled: document.querySelector('[role="menu"] .menu-recent-empty')
      .hasAttribute('disabled'),
  })`);
  assert(
    emptyState.headings === 1 && emptyState.headingText.trim().length > 0,
    `the section heading should stay when the list is empty, got ${JSON.stringify(emptyState)}`,
  );
  assert(
    emptyState.emptyText.trim().length > 0,
    `the empty row should say something, got ${JSON.stringify(emptyState.emptyText)}`,
  );
  assert(
    emptyState.rows === 0,
    `the empty row must not count as a document, got ${emptyState.rows}`,
  );
  assert(
    emptyState.ariaDisabled === "true" && emptyState.reallyDisabled === false,
    `the empty row should be aria-disabled and still focusable, got ${JSON.stringify(emptyState)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while reopening: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    "PASS: recent-files.spec — three rows in the backend's order, clicking the second " +
      "opens the second by index, the list reorders behind it, and an empty list " +
      "still draws its section",
  );
} finally {
  await page.removeInitScript(shimId);
  if (configId) await page.removeInitScript(configId);
  if (emptyConfigId) await page.removeInitScript(emptyConfigId);
  await page.close();
}
