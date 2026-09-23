/**
 * E2E spec — "Go to preview" lands on the block that owns the caret's line.
 *
 * Endnotes are drawn at the end of the document with the line their
 * definition is on, so the preview's blocks are not in line order. The sync
 * used to walk them in document order and stop at the first one past the
 * line: from a note's definition it never reached the note, and from the last
 * paragraph it ran on into the notes. Checked in the paginated view, where
 * the notes end up on the last page, with the caret moved by real keys.
 *
 * The document arrives through the shim, like toc.spec's, so the sample and
 * the shared session are left alone.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

// Line numbers, zero-based as the editor and the preview count them:
// 0 heading, 2 the paragraph that calls the note, 4 a second paragraph,
// 6 the note's definition, 8 the last paragraph.
const DOCUMENT = [
  "# Sincronía",
  "",
  "Un párrafo que llama a una nota.[^a]",
  "",
  "Un segundo párrafo.",
  "",
  "[^a]: El texto de la nota.",
  "",
  "El último párrafo.",
  "",
].join("\n");

const page = await connect(CDP_PORT);
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({ docContent: DOCUMENT })};`;
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor(
    "[...document.querySelectorAll('.paged-view [data-line]')].some((el) => el.textContent.includes('El texto de la nota.'))",
    { timeout: 30000, message: "the paginated view should have drawn the note" },
  );

  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const focused = await page.evaluate(`(() => {
    const content = document.querySelector('.cm-content');
    if (!content) return false;
    content.focus();
    return document.activeElement === content;
  })()`);
  assert(focused, "the editor should take focus");

  // Mod is Cmd on macOS, for CodeMirror's Mod-Home as for everything else.
  const mod = process.platform === "darwin" ? 4 : 2;
  const key = async (modifiers, name, code, keyCode, times = 1) => {
    for (let i = 0; i < times; i++) {
      for (const type of ["keyDown", "keyUp"]) {
        await page.send("Input.dispatchKeyEvent", {
          type,
          modifiers,
          key: name,
          code,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
        });
      }
    }
  };

  /** Press "Go to preview" and read what the preview lit up. */
  const goToPreview = async () => {
    await page.waitFor("!document.querySelector('.paged-view .sync-flash')", {
      message: "the previous jump should have finished its flash",
    });
    const clicked = await page.evaluate(`(() => {
      const button = document.querySelector('.split > .pane:first-child .pane-header .sync-btn:not(.history-btn)');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clicked, "the editor pane should offer Go to preview");
    await page.waitFor("!!document.querySelector('.paged-view .sync-flash')", {
      message: "Go to preview should light up a block",
    });
    return page.evaluate("document.querySelector('.paged-view .sync-flash').textContent.trim()");
  };

  await key(mod, "Home", "Home", 36);
  await key(0, "ArrowDown", "ArrowDown", 40, 6);
  const fromTheNote = await goToPreview();
  assert(
    fromTheNote.includes("El texto de la nota."),
    `from the note's definition, the jump should reach the note, not ${JSON.stringify(fromTheNote)}`,
  );

  await key(0, "ArrowDown", "ArrowDown", 40, 2);
  const fromTheEnd = await goToPreview();
  assert(
    fromTheEnd === "El último párrafo.",
    `from the last paragraph, the jump should stay on it, not ${JSON.stringify(fromTheEnd)}`,
  );

  console.log("PASS: preview-sync.spec — Go to preview reaches the note, and the last paragraph stays itself");
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
