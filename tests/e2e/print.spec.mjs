/**
 * E2E spec — what reaches the printed page.
 *
 * `export_pdf` prints this very webview, so the PDF is whatever the @media
 * print stylesheet leaves visible. That makes print a real output of the app
 * and not just a stylesheet detail: a rule that hides a pane on screen and is
 * not scoped to `screen` silently empties the export.
 *
 * Chrome's media emulation is the only way to see this from a test — jsdom
 * applies no stylesheets, and nothing in the app's own DOM changes when the
 * media type does.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);

/** Computed display of the two panes, in DOM order: editor, preview. */
const panes = () =>
  page.evaluate(`(() => {
    const p = [...document.querySelectorAll('.split > .pane')];
    return {
      count: p.length,
      display: p.map((el) => getComputedStyle(el).display),
      appClass: document.querySelector('.app').className,
    };
  })()`);

const setMedia = (media) => page.send("Emulation.setEmulatedMedia", { media });

try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });

  // ── The baseline: printing shows the preview, not the source ──────
  await setMedia("print");
  const normal = await panes();
  assert(normal.count === 2, `expected two panes, got ${normal.count}`);
  assert(normal.display[0] === "none", "the editor pane should not be printed");
  assert(
    normal.display[1] !== "none",
    `the preview pane is the document and must be printed, got display: ${normal.display[1]}`,
  );

  // ── Zen must not change what comes out ───────────────────────────
  // Zen hides the preview on screen. Ctrl+E exports to PDF and works while
  // zen is on, so if that rule reached print media the export would be blank.
  await setMedia("screen");
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'F11',bubbles:true})); true",
  );
  await page.waitFor("document.querySelector('.app').classList.contains('zen')");

  const zenOnScreen = await panes();
  assert(
    zenOnScreen.display[1] === "none",
    "zen is a writing mode: the preview must stay hidden on screen",
  );

  await setMedia("print");
  const zenInPrint = await panes();
  assert(
    zenInPrint.display[1] !== "none",
    `printing from zen must still produce the document, got display: ${zenInPrint.display[1]}`,
  );
  assert(
    zenInPrint.display[0] === "none",
    "the editor pane should not be printed from zen either",
  );

  await setMedia("");
  await page.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true",
  );
  await page.waitFor("!document.querySelector('.app').classList.contains('zen')");

  assert(page.consoleErrors.length === 0, "console errors: " + page.consoleErrors.join(" | "));
  console.log("PASS: print.spec — the preview reaches the printed page, from zen too");
} finally {
  // Leave the browser on screen media for the specs that follow.
  await page.send("Emulation.setEmulatedMedia", { media: "" }).catch(() => {});
  page.close();
}
