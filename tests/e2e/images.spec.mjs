/**
 * E2E spec — a document's own images reach the preview.
 *
 * `![](assets/shot.png)` means "the file beside this document", and the
 * webview cannot open it: it has no filesystem, and the app deliberately
 * grants it none. The bytes come back through the backend instead, and the
 * only way to see whether that whole path works — command, cache, blob URL,
 * `<img>` — is to let a real browser load the picture and say how big it is.
 * A jsdom test cannot: it has no image decoder, so `naturalWidth` is always
 * zero there and a broken image looks exactly like a working one.
 *
 * The document here is the shim's, not the user's, so nothing in the shared
 * session is touched and there is nothing to restore before closing.
 */
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/** A 2x1 PNG: two pixels wide, so a decoded image is unmistakable. */
const PNG_2x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFklEQVR4nGP8z8Dwn4GBgYEJRIAAQwAeGgIBTn+xGwAAAABJRU5ErkJggg==";

const DOCUMENT = [
  "# Images",
  "",
  "![beside](assets/shot.png)",
  "",
  "![up a level](../shared/logo.png)",
  "",
  "![escaped](assets/mi%20foto.png)",
  "",
  "![missing](assets/gone.png)",
  "",
  "![remote](https://example.invalid/a.png)",
  "",
].join("\n");

const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({
  docHandle: "e2e-img-handle",
  docPath: "/home/e2e/notes/document.md",
  docContent: DOCUMENT,
  images: {
    "assets/shot.png": PNG_2x1,
    "../shared/logo.png": PNG_2x1,
    // Named with a space, and written into the document percent-encoded.
    "assets/mi foto.png": PNG_2x1,
  },
})};`;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  // Registered before the shim so it is already there when the shim builds
  // its session — init scripts run in the order they were added.
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  await page.waitFor(
    "document.querySelectorAll('.preview-web img, .paged-view img').length >= 5",
    { timeout: 20000, message: "the preview should show every image the document names" },
  );

  // Give the resolved ones a moment to decode; a blob URL loads from memory,
  // so this is a formality rather than a wait on the network.
  await page.waitFor(
    `(() => {
      const imgs = [...document.querySelectorAll('.preview-web img, .paged-view img')];
      const resolved = imgs.filter((i) => i.src.startsWith('blob:'));
      return resolved.length >= 3 && resolved.every((i) => i.complete);
    })()`,
    { timeout: 20000, message: "the images beside the document should load" },
  );

  const images = await page.evaluate(`(() => {
    const imgs = [...document.querySelectorAll('.preview-web img, .paged-view img')];
    const seen = new Map();
    for (const img of imgs) {
      const key = img.getAttribute('data-relative-src') ?? img.getAttribute('src');
      if (seen.has(key)) continue;
      seen.set(key, {
        original: img.getAttribute('data-relative-src'),
        src: img.getAttribute('src'),
        width: img.naturalWidth,
        height: img.naturalHeight,
        alt: img.getAttribute('alt'),
      });
    }
    return [...seen.values()];
  })()`);

  const byAlt = (alt) => images.find((i) => i.alt === alt);

  // ── The picture beside the document is really there ──────────────────
  const beside = byAlt("beside");
  assert(beside, "the document's first image should be in the preview");
  assert(
    beside.src.startsWith("blob:"),
    `an image beside the document should be served as a blob, got ${beside.src}`,
  );
  assert(
    beside.width === 2 && beside.height === 1,
    `the picture should have decoded to its real 2x1 size, got ${beside.width}x${beside.height}`,
  );
  assert(
    beside.original === "assets/shot.png",
    `the original link should be kept for the next render, got ${beside.original}`,
  );

  // ── And so is one a level up, which is how folders share pictures ────
  const up = byAlt("up a level");
  assert(
    up.src.startsWith("blob:") && up.width === 2,
    `../shared/logo.png should resolve too, got ${up.src} at ${up.width}px`,
  );

  // ── A name with a space arrives escaped and must still be found ──────
  const escaped = byAlt("escaped");
  assert(
    escaped.src.startsWith("blob:") && escaped.width === 2,
    `a percent-encoded name should be decoded before it is looked up, got ${escaped.src}`,
  );

  // ── What cannot be found is left visibly broken, not hidden ──────────
  const missing = byAlt("missing");
  assert(
    missing.src === "assets/gone.png",
    `a missing image should keep its link and show as broken, got ${missing.src}`,
  );
  assert(
    missing.width === 0,
    "a missing image should not have decoded to anything",
  );

  // ── A remote image is none of our business ───────────────────────────
  const remote = byAlt("remote");
  assert(
    remote.src === "https://example.invalid/a.png",
    `a remote image should be left exactly as written, got ${remote.src}`,
  );
  assert(
    remote.original === null,
    "a remote image should not have been treated as document-relative",
  );

  // ── Read once, then recognised ───────────────────────────────────────
  // Three distinct files, and the preview renders more than once, so a cache
  // that did not work would show up here as a read per render.
  const reads = await page.evaluate(
    "window.__meditorInvokes.filter((i) => i.cmd === 'read_image').length",
  );
  assert(
    reads === 3,
    `each image should have been read exactly once (3), got ${reads}`,
  );
  const stats = await page.evaluate(
    "window.__meditorInvokes.filter((i) => i.cmd === 'image_stat').length",
  );
  assert(
    stats >= reads,
    `every read should be preceded by a stat, got ${stats} stats for ${reads} reads`,
  );

  // ── The paginated view measures the picture, not a gap ───────────────
  // The Document view is where a decoded size actually matters: paged.js
  // works out where a page ends from the height of what is on it, and an
  // image whose bytes have not arrived is zero high.
  // The Document view is the default on a desktop, so it is already there.
  await page.waitFor(
    `!!document.querySelector('.paged-view img[src^="blob:"]')`,
    { timeout: 20000, message: "the paginated view should carry the pictures too" },
  );
  const paged = await page.evaluate(`(() => {
    const img = document.querySelector('.paged-view img[src^="blob:"]');
    const rect = img.getBoundingClientRect();
    return { width: img.naturalWidth, drawn: Math.round(rect.height) };
  })()`);
  assert(
    paged.width === 2,
    `the paginated view should carry the decoded picture too, got ${paged.width}px`,
  );
  assert(
    paged.drawn > 0,
    "an image on a paginated page must have a height, or the page breaks are worked out around nothing",
  );

  assert(
    page.consoleErrors.length === 0,
    `console errors while resolving images: ${JSON.stringify(page.consoleErrors)}`,
  );

  console.log(
    `PASS: images.spec — 3 images beside the document decoded at 2x1 from ${reads} reads ` +
      `(${stats} stats), missing one left broken, remote one untouched`,
  );
} finally {
  await page.removeInitScript(shimId);
  await page.removeInitScript(configId);
  await page.close();
}
