/**
 * E2E spec — a Typst document reads the files beside it.
 *
 * Through the real preview, worker and compiler, with the backend's two
 * commands answered by the shim from a folder it holds: an import and an
 * include that includes in its turn, each relative to the file that names
 * it; JSON read from one folder up, still inside the document's; a PNG and,
 * from the folder's top, an SVG; and a bibliography a citation needs. Any of
 * them missing is a compile error, so a preview without one is the first
 * proof that all arrived.
 *
 * Then a file changed on disk reaches the preview without the document
 * changing; the PDF export is compiled from the files as they are when it
 * runs, not as the preview last had them; and a file the backend turns down
 * is named in the preview, with the reason.
 */
import { inflateSync } from "node:zlib";
import { connect, assert } from "./cdp.mjs";
import { TAURI_SHIM } from "./tauri-shim.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

/**
 * A 2x1 PNG: two pixels wide, so a decoded image is unmistakable. Not the one
 * images.spec uses: a browser overlooks that one's checksum, Typst does not.
 */
const PNG_2x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR42mP4z8DwH4QBEfcD/f6tu5kAAAAASUVORK5CYII=";
const SVG_40x20 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>';

const DOCUMENT = [
  '#import "chapters/one.typ": width',
  "#set page(width: width * 1mm, height: 60mm, margin: 5mm)",
  "= Report",
  '#include "chapters/one.typ"',
  '#image("figures/dot.png", width: 10mm)',
  '#image("/figures/box.svg", width: 10mm)',
  "Cited: @knuth",
  '#bibliography("refs.bib")',
  // Named but never run: the files a document names are fetched before it
  // compiles, so the first two reach the backend, which turns them down. The
  // third is the document itself, which is the text in the editor rather
  // than what was last saved, and is not asked for.
  '#if false { include "../outside.typ"; plugin("tool.wasm"); read("report.typ") }',
  "",
].join("\n");

const FILES = {
  "chapters/one.typ": { text: '#let width = json("../data/size.json").width\nChapter one.\n#include "two.typ"\n' },
  "chapters/two.typ": { text: "Chapter two.\n" },
  "data/size.json": { text: '{"width": 90}', modified: 1 },
  "figures/dot.png": { base64: PNG_2x1 },
  "figures/box.svg": { text: SVG_40x20 },
  "refs.bib": {
    text: "@book{knuth, title = {The TeXbook}, author = {Knuth, Donald E.}, year = {1984}, publisher = {Addison-Wesley}}\n",
  },
  "tool.wasm": { refused: "unsupported" },
};

// A path ending in .typ is what makes the shim's document a Typst one, and a
// handle is what makes it a saved one, with a folder. The interface is kept
// in English, whatever the machine's, for the notice's words.
const CONFIG = `window.__meditorShimConfig = ${JSON.stringify({
  docContent: DOCUMENT,
  docPath: "/e2e/thesis/report.typ",
  docHandle: "e2e-thesis",
  typstFiles: FILES,
})};
localStorage.setItem("meditor.language.v1", "en");`;

/** The preview's width, in the units the compiler wrote it in. */
const PREVIEW_WIDTH = "Number(document.querySelector('.typst-svg-wrapper svg')?.getAttribute('width')) || null";

/** The sheets of a PDF, by their MediaBox width, looking into compressed streams too. */
function mediaBoxWidths(bytes) {
  const texts = [bytes.toString("latin1")];
  const raw = texts[0];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      texts.push(inflateSync(bytes.subarray(start, end)).toString("latin1"));
    } catch {
      // Not deflated, or not a stream: the raw text already has it.
    }
  }
  const widths = [];
  for (const text of texts) {
    for (const box of text.matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)) {
      widths.push(Number(box[3]) - Number(box[1]));
    }
  }
  return widths;
}

const MM_TO_PT = 72 / 25.4;

const page = await connect(CDP_PORT);
let configId;
let shimId;
try {
  configId = await page.addInitScript(CONFIG);
  shimId = await page.addInitScript(TAURI_SHIM);
  await page.freshPage(BASE_URL);
  await page.waitFor(
    "!!document.querySelector('.typst-svg-wrapper svg') || !!document.querySelector('.typst-preview .preview-error')",
    { timeout: 45000, message: "the Typst document should compile, or say why not" },
  );
  const error = await page.evaluate("document.querySelector('.typst-preview .preview-error')?.textContent ?? null");
  assert(error === null, `the document did not compile with its files: ${error}`);

  // Each path as the backend was asked for it: relative to the file that
  // names it, and from the folder's top for one that starts with "/".
  const asked = await page.evaluate(`(() => {
    const calls = window.__meditorInvokes.filter((call) => call.cmd === 'typst_file_stat');
    return {
      handles: [...new Set(calls.map((call) => call.args.handle))],
      paths: [...new Set(calls.map((call) => call.args.relPath))].sort(),
    };
  })()`);
  const expected = [
    "../outside.typ",
    "chapters/one.typ",
    "chapters/two.typ",
    "data/size.json",
    "figures/box.svg",
    "figures/dot.png",
    "refs.bib",
    "tool.wasm",
  ];
  assert(
    JSON.stringify(asked.handles) === '["e2e-thesis"]' && JSON.stringify(asked.paths) === JSON.stringify(expected),
    `the backend was asked for other files than the document names: ${JSON.stringify(asked)}`,
  );

  // Both figures are in the preview, whole.
  const figures = await page.evaluate(`(async () => {
    const found = [];
    for (const image of document.querySelectorAll('.typst-svg-wrapper image')) {
      const source = image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
      const decoded = new Image();
      decoded.src = source;
      try {
        await decoded.decode();
      } catch (error) {
        found.push({ start: source.slice(0, 30), error: String(error) });
        continue;
      }
      found.push({ type: source.slice(5, source.indexOf(';')), size: decoded.naturalWidth + 'x' + decoded.naturalHeight });
    }
    return found;
  })()`);
  const kinds = figures.map((figure) => `${figure.type} ${figure.size}`).sort();
  assert(
    JSON.stringify(kinds) === JSON.stringify(["image/png 2x1", "image/svg+xml 40x20"]),
    `the figures beside the document are not the ones in the preview: ${JSON.stringify(figures)}`,
  );

  // The files the backend turned down, named with the reason.
  const notice = await page.evaluate(`[...document.querySelectorAll('.typst-files-notice li')].map((item) => item.textContent)`);
  assert(
    notice.length === 2 &&
      notice[0] === "../outside.typ: only files in the document's folder, and not hidden ones, can be read" &&
      notice[1] === "tool.wasm: not a kind of file Typst is given",
    `the preview does not say which files were left out, and why: ${JSON.stringify(notice)}`,
  );

  // A file changed by another program reaches the preview on its own: the
  // page is as wide as the JSON says.
  const before = await page.evaluate(PREVIEW_WIDTH);
  await page.evaluate(`window.__meditorSetTypstFile('data/size.json', { text: '{"width": 130}', modified: 2 }); true`);
  await page.waitFor(`Math.abs((${PREVIEW_WIDTH}) / ${before} - 130 / 90) < 0.01`, {
    timeout: 15000,
    message: `the preview did not follow the file changed on disk (it was ${before} wide)`,
  });
  const after = await page.evaluate(PREVIEW_WIDTH);

  // The export compiles the files as they are when it runs. Changed and
  // exported at once, before the preview's next look, so a PDF made from
  // what the worker already held would be 130 mm wide rather than 170.
  const exported = await page.evaluate(`(async () => {
    window.__meditorSetTypstFile('data/size.json', { text: '{"width": 170}', modified: 3 });
    const toggle = document.querySelector('.menu-toggle:not([disabled])');
    if (!toggle) return { error: 'no enabled menu toggle' };
    toggle.click();
    const deadline = Date.now() + 30000;
    let entry = null;
    while (!entry && Date.now() < deadline) {
      entry = [...document.querySelectorAll('[role="menuitem"]:not([disabled])')]
        .find((item) => item.querySelector('.shortcut')?.textContent === 'Ctrl+E');
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!entry) return { error: 'no Export PDF entry in the menu' };
    entry.click();
    let call = null;
    while (!call && Date.now() < deadline) {
      call = window.__meditorInvokes.find((invoke) => invoke.cmd === 'write_pdf_bytes');
      if (!call) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!call) return { error: 'the export wrote no PDF' };
    const bytes = call.args.pdfBytes;
    let binary = '';
    for (let at = 0; at < bytes.length; at += 8192) {
      binary += String.fromCharCode(...bytes.slice(at, at + 8192));
    }
    return { base64: btoa(binary) };
  })()`, 45000);
  assert(!exported.error, `the PDF export check could not run: ${exported.error}`);
  const pdf = Buffer.from(exported.base64, "base64");
  assert(pdf.subarray(0, 5).toString("latin1") === "%PDF-", "the export did not write a PDF");
  const widths = mediaBoxWidths(pdf);
  assert(
    widths.length > 0 && widths.every((width) => Math.abs(width - 170 * MM_TO_PT) < 0.5),
    `the PDF was not compiled from the files as they are now (170 mm = ${(170 * MM_TO_PT).toFixed(2)} pt): ${JSON.stringify(widths)}`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `typst-files.spec ok — ${expected.length} files named, 6 read, 2 refused and named in the preview; ` +
      `the figures arrived whole; a changed file reached the preview (${before} → ${after} wide) ` +
      `and the PDF export (${widths.length} sheets, ${widths[0].toFixed(2)} pt wide)`,
  );
} finally {
  if (shimId) await page.removeInitScript(shimId).catch(() => {});
  if (configId) await page.removeInitScript(configId).catch(() => {});
  await page.close();
}
