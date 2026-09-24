/**
 * E2E spec — Typst compiles with the application's own fonts.
 *
 * typst.ts used to download its seventeen default fonts from a CDN, through a
 * loader that starts by evaluating a string. The desktop app's policy refuses
 * that, so Typst never started there, and nowhere without a network. The fonts
 * now ship in `public/typst-fonts` and go to the compiler directly
 * (src/typstFonts.ts). This checks, from the network's side, that the whole
 * Typst sample compiles to SVG with nothing fetched from outside the page and
 * every font fetched from inside it.
 *
 * It runs in the built run too, under the desktop app's policy, and that is
 * the half that matters most: the WASM compiler evaluates strings of its own
 * when it starts, which the page's policy refuses, so the compiler runs in a
 * worker (src/typstWorker.ts), where it may. cdp.mjs fails the spec on any
 * policy violation. The PDF export goes through the same worker and is
 * checked as well.
 *
 * The fonts are fetched by that worker, so its requests are watched as well
 * as the page's: it is attached as it starts and held until its network is
 * being recorded, so not one request is missed.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);
const requests = [];
// Commands to an attached worker go out on its session, raw: CdpSession only
// speaks to the page. Ids far from the session's own, so no reply is mistaken
// for one it is waiting for.
let rawId = 900000;
const toWorker = (sessionId, method) =>
  page.ws.send(JSON.stringify({ id: rawId++, method, params: {}, sessionId }));
page.onMessage((msg) => {
  if (msg.method === "Network.requestWillBeSent") requests.push(msg.params.request.url);
  if (msg.method === "Target.attachedToTarget" && msg.params.targetInfo.type === "worker") {
    toWorker(msg.params.sessionId, "Network.enable");
    toWorker(msg.params.sessionId, "Runtime.runIfWaitingForDebugger");
  }
});

try {
  await page.send("Network.enable");
  await page.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 20000 });
  const origin = new URL(BASE_URL).origin;

  // A new Typst document from the menu, the way wasm.spec opens one: found by
  // what it names (".typ" / Typst), not by a translated label. Opened and
  // clicked in the same evaluation, since the menu is React's to redraw.
  await page.waitFor(`(() => {
    const toggle = document.querySelector('button[aria-haspopup="menu"]');
    if (!(toggle instanceof HTMLElement)) return false;
    if (!document.querySelector('[role="menu"]')) toggle.click();
    const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .find((el) => /typst/i.test(el.textContent || '') || (el.textContent || '').toLowerCase().includes('.typ'));
    if (!(item instanceof HTMLElement)) return false;
    item.click();
    return true;
  })()`, { timeout: 10000, message: "the menu should offer a new Typst document" });

  await page.waitFor("!!document.querySelector('.typst-svg-wrapper svg')", {
    timeout: 45000,
    message: "the Typst sample should compile to SVG with the application's fonts",
  });
  const error = await page.evaluate(
    "document.querySelector('.typst-preview .preview-error')?.textContent ?? null",
  );
  assert(error === null, `the Typst preview reported an error: ${error}`);

  const fromCdn = requests.filter((url) => url.includes("cdn.jsdelivr.net") || url.includes("typst-assets"));
  assert(fromCdn.length === 0, `Typst still fetched from outside the application: ${fromCdn.join(", ")}`);
  const fonts = new Set(
    requests.filter((url) => url.startsWith(`${origin}/`) && url.includes("/typst-fonts/")),
  );
  assert(
    fonts.size === 17,
    `expected the 17 Typst fonts from the application, saw ${fonts.size}: ${[...fonts].join(", ")}`,
  );

  // The PDF is made in the worker too, and its bytes are moved to the page
  // rather than copied. Exported twice: bytes the worker still needed would
  // leave the second one empty. The web build saves by downloading a Blob,
  // which is read here instead of being written to disk. The entry is found by
  // its shortcut label, which reads "Ctrl+E" in every language; the menu is
  // disabled while an export runs, so waiting for it waits for the first.
  const exported = await page.evaluate(`(async () => {
    const blobs = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { blobs.push(blob); return createObjectURL(blob); };
    document.addEventListener('click', (event) => {
      if (event.target instanceof HTMLAnchorElement && event.target.download) event.preventDefault();
    }, true);
    const deadline = Date.now() + 30000;
    const until = async (check) => {
      while (Date.now() < deadline) {
        const found = check();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    const files = [];
    for (let round = 1; round <= 2; round++) {
      const toggle = await until(() => document.querySelector('.menu-toggle:not([disabled])'));
      if (!toggle) return { error: 'no enabled menu toggle before export ' + round };
      toggle.click();
      const entry = await until(() => [...document.querySelectorAll('[role="menuitem"]:not([disabled])')]
        .find((item) => item.querySelector('.shortcut')?.textContent === 'Ctrl+E'));
      if (!entry) return { error: 'no Export PDF entry in the menu for export ' + round };
      entry.click();
      const blob = await until(() => blobs[round - 1]);
      if (!blob) return { error: 'export ' + round + ' produced no file' };
      const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
      files.push({ head, size: blob.size, type: blob.type });
    }
    return { files };
  })()`, 45000);
  assert(!exported.error, `the PDF export check could not run: ${exported.error}`);
  for (const [index, file] of exported.files.entries()) {
    assert(
      file.head === "%PDF-" && file.type === "application/pdf" && file.size > 1000,
      `export ${index + 1} is not a PDF: ${JSON.stringify(file)}`,
    );
  }

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    "typst.spec ok — the Typst sample compiled with the 17 fonts served by the application, none from a CDN, " +
      `and exported to PDF twice (${exported.files.map((file) => file.size).join(" and ")} bytes)`,
  );
} finally {
  page.close();
}
