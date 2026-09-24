/**
 * E2E spec — the Typst preview's stylesheet stays inside the preview.
 *
 * The SVG typst.ts writes carries a stylesheet, and a stylesheet in an SVG
 * that sits in an HTML page applies to the whole page. One of its rules is a
 * bare `svg { fill: none; }`: while a Typst document was open, the menu's ⋮,
 * the one icon in the interface drawn with a fill, went blank. This opens the
 * Typst sample and checks, rule by rule, that Typst's stylesheet reaches
 * nothing outside the preview, and that it still reaches the preview itself.
 */
import { connect, assert } from "./cdp.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1420";
const CDP_PORT = Number(process.env.CDP_PORT);
if (!CDP_PORT) throw new Error("CDP_PORT env var is required");

const MENU_DOTS_FILL = "getComputedStyle(document.querySelector('.menu-toggle svg circle')).fill";

const page = await connect(CDP_PORT);
try {
  await page.freshPage(BASE_URL);
  await page.waitFor("!!document.querySelector('.cm-content') && !!document.querySelector('.menu-toggle svg circle')", {
    timeout: 20000,
  });
  const before = await page.evaluate(MENU_DOTS_FILL);

  // A new Typst document from the menu, the way typst.spec opens one: found by
  // what it names, and opened and clicked in the same evaluation, since the
  // menu is React's to redraw.
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
    message: "the Typst sample should compile to SVG",
  });

  // Every rule of every stylesheet inside the preview, and what it matches in
  // the whole page. An element is matched without the rule's pseudo-element
  // (::selection), which querySelectorAll does not take.
  const reach = await page.evaluate(`(() => {
    const wrapper = document.querySelector('.typst-svg-wrapper');
    const selectors = [];
    const collect = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText) selectors.push(rule.selectorText);
        else if (rule.cssRules && !(rule instanceof CSSKeyframesRule)) collect(rule.cssRules);
      }
    };
    for (const style of wrapper.querySelectorAll('style')) if (style.sheet) collect(style.sheet.cssRules);
    const outside = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector.replace(/::[\\w-]+/g, ''))) {
        if (wrapper.contains(element)) continue;
        const name = element.tagName.toLowerCase();
        const classes = element.getAttribute('class');
        outside.push(selector + ' -> ' + name + (classes ? '.' + classes.trim().split(/\\s+/).join('.') : ''));
      }
    }
    return {
      rules: selectors.length,
      outside: [...new Set(outside)].slice(0, 8),
      previewFill: getComputedStyle(wrapper.querySelector('svg')).fill,
    };
  })()`);
  assert(reach.rules > 0, "no stylesheet was found in the Typst preview, so there was nothing to check");
  assert(
    reach.outside.length === 0,
    `Typst's stylesheet reaches outside its preview: ${reach.outside.join(" | ")}`,
  );
  assert(
    reach.previewFill === "none",
    `Typst's own rules no longer reach its preview: the page's SVG has fill ${reach.previewFill}`,
  );

  const after = await page.evaluate(MENU_DOTS_FILL);
  assert(
    after === before && after !== "none",
    `the menu's dots were filled with ${before} and are filled with ${after} while Typst is open`,
  );

  assert(
    page.consoleErrors.length === 0,
    "console errors: " + page.consoleErrors.join(" | "),
  );
  console.log(
    `typst-styles.spec ok — ${reach.rules} rules of Typst's stylesheet reach only its preview; the menu's dots keep ${after}`,
  );
} finally {
  page.close();
}
