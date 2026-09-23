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
 * Development run only, for now. Under the desktop app's policy the WASM
 * compiler still evaluates strings of its own when it starts (default
 * callbacks it builds with `new Function`), which the policy refuses whatever
 * the fonts do; a built run under that policy would fail for that reason.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const page = await connect(CDP_PORT);
const requests = [];
page.onMessage((msg) => {
  if (msg.method === "Network.requestWillBeSent") requests.push(msg.params.request.url);
});

try {
  await page.send("Network.enable");
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

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log("typst.spec ok — the Typst sample compiled with the 17 fonts served by the application, none from a CDN");
} finally {
  page.close();
}
